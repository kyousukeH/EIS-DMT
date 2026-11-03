import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 8080);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dirname, '../dist');
const mode = process.env.NODE_ENV === 'test' && process.env.APP_MODE === 'mock' ? 'mock' : 'cluster';
const namespace = process.env.FORKLIFT_NAMESPACE || 'konveyor-forklift';
const kubernetesApi = process.env.KUBERNETES_API_URL || 'https://kubernetes.default.svc';
const inventoryApi = process.env.INVENTORY_API_URL || `https://forklift-inventory.${namespace}.svc:8443`;
const tokenFile = process.env.K8S_TOKEN_FILE || '/var/run/secrets/kubernetes.io/serviceaccount/token';
const authRequired = process.env.CONSOLE_AUTH_REQUIRED !== 'false' && mode === 'cluster';
const authUsername = process.env.CONSOLE_USERNAME || 'admin';
const authPasswordFile = process.env.CONSOLE_PASSWORD_FILE || '/var/run/secrets/console-auth/password';
const queuedStarts = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb', type: ['application/json', 'application/merge-patch+json'] }));

const runtimeConfig = {
  mode,
  namespace,
  inventoryEnabled: process.env.INVENTORY_ENABLED !== 'false',
  defaultStorageClass: process.env.DEFAULT_STORAGE_CLASS || 'ocs-storagecluster-ceph-rbd',
  defaultVolumeMode: process.env.DEFAULT_VOLUME_MODE || 'Block',
  defaultAccessMode: process.env.DEFAULT_ACCESS_MODE || 'ReadWriteOnce',
  version: process.env.APP_VERSION || '0.1.0',
};

function readToken() {
  if (process.env.K8S_BEARER_TOKEN) return process.env.K8S_BEARER_TOKEN;
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function basicAuth(req, res, next) {
  if (!authRequired || req.path === '/healthz' || req.path === '/readyz') return next();
  let expectedPassword;
  try {
    expectedPassword = fs.readFileSync(authPasswordFile, 'utf8').trim();
  } catch {
    res.status(503).json({ message: 'Console authentication secret is not configured.' });
    return;
  }
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && value) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (separator > 0 && constantTimeEqual(username, authUsername) && constantTimeEqual(password, expectedPassword)) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="EIS-DMT", charset="UTF-8"');
  res.status(401).json({ message: 'Authentication required.' });
}

async function proxy(req, res, baseUrl) {
  if (mode !== 'cluster') {
    res.status(503).json({ message: 'Upstream APIs are disabled in mock mode.' });
    return;
  }
  try {
    const suffix = req.originalUrl.replace(/^\/api\/(k8s|inventory)/, '');
    const headers = {
      accept: req.headers.accept || 'application/json',
      authorization: `Bearer ${readToken()}`,
    };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const response = await fetch(new URL(suffix, `${baseUrl}/`), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000),
    });
    res.status(response.status);
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Upstream proxy failed', error);
    res.status(502).json({ message: 'Upstream request failed', detail: error instanceof Error ? error.message : String(error) });
  }
}

async function kubernetesRequest(apiPath, init = {}) {
  const response = await fetch(new URL(apiPath, `${kubernetesApi}/`), {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${readToken()}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(body?.message || body?.reason || `集群请求失败（${response.status}）`);
  return body;
}

const planPath = (name) => `apis/forklift.konveyor.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/plans/${encodeURIComponent(name)}`;

async function markQueuedStart(planName, status, message = '') {
  await kubernetesRequest(planPath(planName), {
    method: 'PATCH',
    headers: { 'content-type': 'application/merge-patch+json' },
    body: JSON.stringify({ metadata: { annotations: {
      'eis-dmt.io/auto-start-status': status,
      'eis-dmt.io/auto-start-message': message,
      'eis-dmt.io/auto-start-updated-at': new Date().toISOString(),
    } } }),
  });
}

function planReady(plan) {
  const conditions = plan?.status?.conditions || [];
  const current = plan?.metadata?.generation === undefined || plan?.status?.observedGeneration === plan?.metadata?.generation;
  const ready = conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True');
  const executing = conditions.some((condition) => condition.type === 'Executing' && condition.status === 'True');
  const completed = conditions.some((condition) => condition.status === 'True' && /Succeeded|Completed/i.test(condition.type || ''));
  const blocker = conditions.find((condition) => condition.status === 'True'
    && (['Critical', 'Error'].includes(condition.category || '') || /Failed|Invalid/i.test(condition.type || '')));
  const blockerText = [blocker?.type, blocker?.reason, blocker?.message].filter(Boolean).join(' ');
  const waitingForDependency = Boolean(blocker && /does not have (?:a )?Ready condition|map\.(?:network|storage).*ready|(?:network|storage)map.*not ready/i.test(blockerText));
  return {
    ready: current && ready && !executing && !blocker,
    blocker: waitingForDependency ? undefined : blocker,
    alreadyStarted: executing || completed,
  };
}

async function startWhenReady(planName, migration) {
  try {
    await markQueuedStart(planName, 'queued', '正在等待任务检查完成');
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      const plan = await kubernetesRequest(planPath(planName));
      const state = planReady(plan);
      if (state.blocker) throw new Error(state.blocker.message || state.blocker.reason || '迁移任务检查未通过');
      if (state.alreadyStarted) {
        await markQueuedStart(planName, 'started', '迁移已经开始或完成');
        return;
      }
      if (state.ready) {
        const collection = `apis/forklift.konveyor.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/migrations`;
        const create = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(migration),
        };
        await kubernetesRequest(`${collection}?dryRun=All`, create);
        await kubernetesRequest(collection, create);
        await markQueuedStart(planName, 'started', '迁移已启动');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('任务在 120 秒内未进入可执行状态，请检查任务详情');
  } catch (error) {
    await markQueuedStart(planName, 'failed', error instanceof Error ? error.message : String(error)).catch(() => undefined);
  } finally {
    queuedStarts.delete(planName);
  }
}

app.use(basicAuth);
app.get('/api/config', (_req, res) => res.json(runtimeConfig));
app.post('/api/actions/start-when-ready', (req, res) => {
  const { planName, migration } = req.body || {};
  if (!planName || !migration?.spec?.plan?.name || migration.spec.plan.name !== planName) {
    res.status(400).json({ message: '启动请求缺少有效的迁移任务信息。' });
    return;
  }
  if (!queuedStarts.has(planName)) {
    const queued = startWhenReady(planName, migration);
    queuedStarts.set(planName, queued);
  }
  res.status(202).json({ queued: true });
});
app.all('/api/k8s/*path', (req, res) => proxy(req, res, kubernetesApi));
app.all('/api/inventory/*path', (req, res) => proxy(req, res, inventoryApi));
app.get('/healthz', (_req, res) => res.json({ status: 'ok', mode }));
app.get('/readyz', async (_req, res) => {
  if (mode === 'mock') return res.json({ status: 'ready', mode });
  try {
    const response = await fetch(`${kubernetesApi}/version`, {
      headers: { authorization: `Bearer ${readToken()}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Kubernetes API returned ${response.status}`);
    res.json({ status: 'ready', mode });
  } catch (error) {
    res.status(503).json({ status: 'not-ready', message: error instanceof Error ? error.message : String(error) });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*path', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`EIS-DMT listening on :${port} (${mode} mode)`);
});
