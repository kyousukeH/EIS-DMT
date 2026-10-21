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

app.use(basicAuth);
app.get('/api/config', (_req, res) => res.json(runtimeConfig));
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
