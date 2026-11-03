import type {
  Condition,
  ForkliftController,
  InventoryNamespace,
  InventoryResource,
  InventoryVM,
  KubernetesPersistentVolumeClaim,
  KubeList,
  Migration,
  NetworkMap,
  Plan,
  Provider,
  RuntimeConfig,
  StorageMap,
} from '../domain/types';
import {
  mockInventoryNamespaces,
  mockInventoryVMs,
  mockTargetInventoryVMs,
  mockSourceNetworks,
  mockSourceStorages,
  mockTargetNetworks,
  mockTargetStorages,
  mockList,
  mockStore,
} from './mock';
import { configuredDisks, parseKubernetesQuantity, sourceStoragePath } from '../domain/inventory';
import { isEISTargetProvider, isLocalEISTargetProvider } from '../domain/providers';

export type ForkliftResource = 'providers' | 'networkmaps' | 'storagemaps' | 'plans' | 'migrations' | 'forkliftcontrollers';

let config: RuntimeConfig;

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiRequestError(detail.message || detail.reason || `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const embeddedConfig = (globalThis as typeof globalThis & { __EIS_DMT_CONFIG__?: RuntimeConfig }).__EIS_DMT_CONFIG__;
  if (embeddedConfig) {
    config = structuredClone(embeddedConfig);
    return config;
  }
  config = await request<RuntimeConfig>('/api/config');
  return config;
}

export function getRuntimeConfig(): RuntimeConfig {
  return config;
}

const resourceUrl = (resource: ForkliftResource, name?: string) => {
  const base = `/api/k8s/apis/forklift.konveyor.io/v1beta1/namespaces/${config.namespace}/${resource}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
};

export async function listResource<T>(resource: ForkliftResource): Promise<KubeList<T>> {
  if (config.mode === 'mock') return structuredClone(mockList<T>(resource));
  return request<KubeList<T>>(resourceUrl(resource));
}

export async function createResource<T extends { metadata: { name?: string } }>(resource: ForkliftResource, body: T): Promise<T> {
  if (config.mode === 'mock') {
    const created = structuredClone(body) as T & { metadata: Record<string, any>; status?: Record<string, any> };
    if (resource === 'plans' && !created.status) {
      created.metadata.generation = created.metadata.generation || 1;
      created.status = {
        observedGeneration: created.metadata.generation,
        conditions: [{ type: 'Ready', status: 'True', message: 'Plan is ready' }],
      };
    }
    (mockStore[resource] as unknown as T[]).push(created);
    if (resource === 'migrations') {
      const migration = created as unknown as Migration;
      const plan = mockStore.plans.find((item) => item.metadata.name === migration.spec.plan.name);
      if (plan) {
        const started = new Date().toISOString();
        plan.status = {
          ...plan.status,
          observedGeneration: plan.metadata.generation,
          conditions: [{ type: 'Executing', status: 'True', message: 'Migration is executing' }],
          migration: {
            ...plan.status?.migration,
            started,
            history: [
              ...(plan.status?.migration?.history || []),
              { migration: { name: migration.metadata.name, uid: migration.metadata.uid }, started },
            ],
          },
        };
      }
    }
    return structuredClone(created);
  }
  const init = {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  };
  await request<T>(`${resourceUrl(resource)}?dryRun=All`, init);
  return request<T>(resourceUrl(resource), init);
}

export async function patchResource<T>(resource: ForkliftResource, name: string, patch: object): Promise<T> {
  if (config.mode === 'mock') {
    const items = mockStore[resource] as unknown as Array<Record<string, any>>;
    const item = items.find((value) => value.metadata?.name === name);
    if (!item) throw new Error(`${resource}/${name} not found`);
    if ('metadata' in patch) {
      const metadata = (patch as { metadata: Record<string, any> }).metadata;
      item.metadata = {
        ...item.metadata,
        ...metadata,
        labels: { ...item.metadata?.labels, ...metadata.labels },
        annotations: { ...item.metadata?.annotations, ...metadata.annotations },
      };
    }
    if ('spec' in patch) item.spec = { ...item.spec, ...(patch as { spec: object }).spec };
    return structuredClone(item) as T;
  }
  return request<T>(resourceUrl(resource, name), {
    method: 'PATCH', headers: { 'content-type': 'application/merge-patch+json' }, body: JSON.stringify(patch),
  });
}

export async function deleteResource(resource: ForkliftResource, name: string): Promise<void> {
  if (config.mode === 'mock') {
    const items = mockStore[resource] as unknown as Array<{ metadata: { name?: string } }>;
    const index = items.findIndex((item) => item.metadata.name === name);
    if (index >= 0) items.splice(index, 1);
    return;
  }
  await request(resourceUrl(resource, name), { method: 'DELETE' });
}

export async function getResource<T>(resource: ForkliftResource, name: string): Promise<T> {
  if (config.mode === 'mock') {
    const items = mockStore[resource] as unknown as Array<{ metadata: { name?: string } }>;
    const item = items.find((value) => value.metadata.name === name);
    if (!item) throw new Error(`${resource}/${name} not found`);
    return structuredClone(item) as T;
  }
  return request<T>(resourceUrl(resource, name));
}

export interface PlanActionRecord {
  action: string;
  at: string;
  detail?: string;
}

export const planActionHistoryAnnotation = 'eis-dmt.io/action-history';

export async function appendPlanAction(planName: string, action: string, detail?: string): Promise<void> {
  const plan = await getResource<Plan>('plans', planName);
  let history: PlanActionRecord[] = [];
  try {
    const stored = plan.metadata.annotations?.[planActionHistoryAnnotation];
    if (stored) history = JSON.parse(stored) as PlanActionRecord[];
  } catch {
    history = [];
  }
  history.push({ action, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
  await patchResource<Plan>('plans', planName, {
    metadata: { annotations: { [planActionHistoryAnnotation]: JSON.stringify(history.slice(-30)) } },
  });
}

function planIsReady(plan: Plan) {
  const conditions = plan.status?.conditions || [];
  const currentGeneration = plan.metadata.generation === undefined
    || plan.status?.observedGeneration === plan.metadata.generation;
  const ready = conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True');
  const executing = conditions.some((condition) => condition.type === 'Executing' && condition.status === 'True');
  const blocked = conditions.some((condition) => condition.status === 'True'
    && (['Critical', 'Error'].includes(condition.category || '') || /Failed|Invalid/i.test(condition.type)));
  return currentGeneration && ready && !executing && !blocked;
}

function isTemporaryPlanCondition(condition: Condition) {
  const text = [condition.type, condition.reason, condition.message].filter(Boolean).join(' ');
  return /does not have (?:a )?Ready condition|map\.(?:network|storage).*ready|(?:network|storage)map.*not ready/i.test(text);
}

export async function waitForPlanReady(name: string, timeoutMs = 120_000): Promise<Plan> {
  const started = Date.now();
  let lastPlan: Plan | undefined;
  while (Date.now() - started < timeoutMs) {
    lastPlan = await getResource<Plan>('plans', name);
    if (planIsReady(lastPlan)) return lastPlan;
    const failure = lastPlan.status?.conditions?.find((condition) => condition.status === 'True'
      && (['Critical', 'Error'].includes(condition.category || '') || /Failed|Invalid/i.test(condition.type))
      && !isTemporaryPlanCondition(condition));
    if (failure) throw new Error(failure.message || failure.reason || '迁移任务校验未通过');
    await new Promise((resolve) => setTimeout(resolve, config.mode === 'mock' ? 10 : 2_000));
  }
  throw new Error(`迁移任务在 ${Math.round(timeoutMs / 1000)} 秒内未进入可执行状态，请在任务详情中检查校验结果。`);
}

export async function queuePlanStart(planName: string, migration: Migration): Promise<{ queued: boolean; plan?: Plan }> {
  if (config.mode === 'mock') {
    await waitForPlanReady(planName);
    await createResource('migrations', migration);
    return { queued: true, plan: await getResource<Plan>('plans', planName) };
  }
  return request<{ queued: boolean; plan?: Plan }>('/api/actions/start-when-ready', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ planName, migration }),
  });
}

export interface RollbackResult {
  cleanupRequested: { pods: boolean; virtualMachines: boolean; dataVolumes: boolean; persistentVolumeClaims: boolean };
}

async function deleteObjectsByPlan(apiPrefix: string, resource: string, namespace: string, planUID: string, resourceLabel: string) {
  const base = `/api/k8s/${apiPrefix}/namespaces/${encodeURIComponent(namespace)}/${resource}`;
  const selector = encodeURIComponent(`plan=${planUID}`);
  try {
    // Kubernetes collection deletion applies the label selector server-side and
    // avoids requiring broad list access to workloads in the target namespace.
    await request<unknown>(`${base}?labelSelector=${selector}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background' }),
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return;
    if (error instanceof ApiRequestError && error.status === 403) {
      throw new Error(`控制台没有清理目标资源空间“${namespace}”中${resourceLabel}的权限，请更新该资源空间的清理授权后重试。`);
    }
    throw error;
  }
}

export async function rollbackPlanResources(plan: Plan, migration?: Migration): Promise<RollbackResult> {
  if (migration) {
    await patchResource<Migration>('migrations', migration.metadata.name, {
      spec: { cancel: plan.spec.vms.map((vm) => ({ id: vm.id })) },
    });
  }

  const emptyResult: RollbackResult = {
    cleanupRequested: { pods: false, virtualMachines: false, dataVolumes: false, persistentVolumeClaims: false },
  };
  if (config.mode === 'mock') {
    await patchResource<Plan>('plans', plan.metadata.name, {
      metadata: { annotations: { 'eis-dmt.io/rollback-status': 'requested', 'eis-dmt.io/rollback-at': new Date().toISOString() } },
    });
    return emptyResult;
  }
  if (!plan.metadata.uid) throw new Error('任务缺少资源标识，无法安全确认其创建的目标资源。');

  const namespace = plan.spec.targetNamespace;
  const planUID = plan.metadata.uid;
  const cleanupRequested: RollbackResult['cleanupRequested'] = {
    pods: false, virtualMachines: false, dataVolumes: false, persistentVolumeClaims: false,
  };
  const cleanups: Array<{
    key: keyof RollbackResult['cleanupRequested']; apiPrefix: string; resource: string; label: string;
  }> = [
    { key: 'pods', apiPrefix: 'api/v1', resource: 'pods', label: '数据传输任务' },
    { key: 'virtualMachines', apiPrefix: 'apis/kubevirt.io/v1', resource: 'virtualmachines', label: '目标虚拟机' },
    { key: 'dataVolumes', apiPrefix: 'apis/cdi.kubevirt.io/v1beta1', resource: 'datavolumes', label: '目标数据卷' },
    { key: 'persistentVolumeClaims', apiPrefix: 'api/v1', resource: 'persistentvolumeclaims', label: '目标磁盘声明' },
  ];
  const failures: string[] = [];
  for (const cleanup of cleanups) {
    try {
      await deleteObjectsByPlan(cleanup.apiPrefix, cleanup.resource, namespace, planUID, cleanup.label);
      cleanupRequested[cleanup.key] = true;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error(Array.from(new Set(failures)).join(' '));
  await patchResource<Plan>('plans', plan.metadata.name, {
    metadata: { annotations: { 'eis-dmt.io/rollback-status': 'requested', 'eis-dmt.io/rollback-at': new Date().toISOString() } },
  });
  return { cleanupRequested };
}

export async function createProviderWithSecret(
  provider: Provider,
  stringData: Record<string, string>,
): Promise<Provider> {
  if (config.mode === 'mock') return createResource('providers', provider);
  const secretName = `${provider.metadata.name}-credentials`;
  const secretUrl = `/api/k8s/api/v1/namespaces/${config.namespace}/secrets`;
  await request(secretUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: {
        name: secretName,
        namespace: config.namespace,
        labels: { 'app.kubernetes.io/managed-by': 'forklift-migration-console' },
      },
      stringData,
    }),
  });
  provider.spec.secret = { name: secretName, namespace: config.namespace };
  try {
    return await createResource('providers', provider);
  } catch (error) {
    await request(`${secretUrl}/${encodeURIComponent(secretName)}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
}

export async function updateProviderWithSecret(
  provider: Provider,
  stringData?: Record<string, string>,
): Promise<Provider> {
  if (config.mode === 'mock') {
    return patchResource<Provider>('providers', provider.metadata.name, {
      metadata: { labels: provider.metadata.labels }, spec: provider.spec,
    });
  }
  if (stringData && Object.keys(stringData).length > 0) {
    const secretName = provider.spec.secret?.name || `${provider.metadata.name}-credentials`;
    const secretNamespace = provider.spec.secret?.namespace || config.namespace;
    await request(
      `/api/k8s/api/v1/namespaces/${encodeURIComponent(secretNamespace)}/secrets/${encodeURIComponent(secretName)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify({ stringData }),
      },
    );
  }
  return patchResource<Provider>('providers', provider.metadata.name, {
    metadata: { labels: provider.metadata.labels }, spec: provider.spec,
  });
}

async function enrichLocalTargetVMDisks(vms: InventoryVM[]): Promise<InventoryVM[]> {
  const namespaces = Array.from(new Set(vms.flatMap((vm) => {
    const hasReferencedDisk = configuredDisks({ ...vm, disks: undefined }).length > 0;
    const namespace = vm.namespace || vm.object?.metadata?.namespace;
    return hasReferencedDisk && namespace ? [namespace] : [];
  })));
  if (namespaces.length === 0) return vms;

  const claimsByKey = new Map<string, KubernetesPersistentVolumeClaim>();
  await Promise.all(namespaces.map(async (namespace) => {
    try {
      const result = await request<KubeList<KubernetesPersistentVolumeClaim>>(
        `/api/k8s/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`,
      );
      result.items.forEach((claim) => claimsByKey.set(`${namespace}/${claim.metadata.name}`.toLowerCase(), claim));
    } catch {
      // Inventory data remains usable when a remote namespace does not grant PVC list access.
    }
  }));

  return vms.map((vm) => {
    const namespace = vm.namespace || vm.object?.metadata?.namespace || '';
    const referencedDisks = configuredDisks({ ...vm, disks: undefined });
    if (referencedDisks.length === 0) return vm;
    let matchedClaims = 0;
    const disks = referencedDisks.map((disk) => {
      const claim = disk.claimName ? claimsByKey.get(`${namespace}/${disk.claimName}`.toLowerCase()) : undefined;
      if (!claim) return disk;
      matchedClaims += 1;
      const requestedCapacity = claim.spec?.resources?.requests?.storage || claim.status?.capacity?.storage;
      return {
        ...disk,
        capacity: parseKubernetesQuantity(requestedCapacity),
        storageClassName: claim.spec?.storageClassName,
        volumeMode: claim.spec?.volumeMode,
        accessModes: claim.spec?.accessModes,
      };
    });
    return matchedClaims > 0 || !(vm.disks || []).length ? { ...vm, disks } : vm;
  });
}

export async function listInventoryVMs(provider: Provider): Promise<InventoryVM[]> {
  if (config.mode === 'mock') return structuredClone(isEISTargetProvider(provider) ? mockTargetInventoryVMs : mockInventoryVMs);
  if (!provider.metadata.uid) return [];
  const params = new URLSearchParams({ detail: '1' });
  // Host-provider VM inventory is cluster-wide unless a namespace is requested.
  // The console namespace is not where migrated workloads are usually created.
  if (!isEISTargetProvider(provider)) params.set('namespace', config.namespace);
  const vms = await request<InventoryVM[]>(
    `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/vms?${params.toString()}`,
  );
  return isLocalEISTargetProvider(provider) ? enrichLocalTargetVMDisks(vms) : vms;
}

function inventoryProviderUrl(provider: Provider, resource: string, namespace?: string) {
  if (!provider.metadata.uid) return undefined;
  const params = new URLSearchParams({ detail: '1' });
  if (namespace) params.set('namespace', namespace);
  return `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/${resource}?${params.toString()}`;
}

export async function listInventoryNetworks(provider: Provider, role: 'source' | 'target', namespace?: string): Promise<InventoryResource[]> {
  if (config.mode === 'mock') {
    const resources = role === 'source' ? mockSourceNetworks : mockTargetNetworks;
    return structuredClone(role === 'target' && namespace
      ? resources.filter((resource) => !resource.namespace || resource.namespace === namespace)
      : resources);
  }
  const path = provider.spec.type === 'openshift' ? 'networkattachmentdefinitions' : 'networks';
  const url = inventoryProviderUrl(provider, path, role === 'target' ? namespace : undefined);
  if (!url) return [];
  const resources = await request<InventoryResource[]>(url);
  return role === 'source' && provider.spec.type === 'openshift'
    ? [{ id: 'pod', name: '默认集群网络', type: 'pod' }, ...resources]
    : resources;
}

export async function listInventoryStorages(provider: Provider, role: 'source' | 'target'): Promise<InventoryResource[]> {
  if (config.mode === 'mock') {
    return structuredClone(role === 'source' ? mockSourceStorages : mockTargetStorages);
  }
  const path = role === 'target' ? 'storageclasses' : sourceStoragePath(provider.spec.type);
  const url = inventoryProviderUrl(provider, path);
  return url ? request<InventoryResource[]>(url) : [];
}

export async function listInventoryNamespaces(provider: Provider): Promise<InventoryNamespace[]> {
  if (config.mode === 'mock') return structuredClone(mockInventoryNamespaces);
  if (!provider.metadata.uid) return [];
  return request<InventoryNamespace[]>(
    `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/namespaces?detail=1`,
  );
}

export type TargetVirtualMachineAction = 'start' | 'stop';

function targetVirtualMachineUrl(namespace: string, name: string) {
  return `/api/k8s/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
}

function targetVirtualMachineActionUrl(namespace: string, name: string, action: TargetVirtualMachineAction) {
  return `/api/k8s/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/${action}`;
}

function targetVirtualMachineError(error: unknown, namespace: string, action: string): never {
  if (error instanceof ApiRequestError && error.status === 403) {
    throw new Error(`控制台没有在目标资源空间“${namespace}”中${action}虚拟机的权限，请更新目标资源空间授权后重试。`);
  }
  if (error instanceof ApiRequestError && error.status === 404) {
    throw new Error('目标虚拟机已不存在，请刷新资源列表。');
  }
  throw error;
}

export async function setTargetVirtualMachinePower(namespace: string, name: string, action: TargetVirtualMachineAction): Promise<void> {
  if (config.mode === 'mock') {
    const vm = mockTargetInventoryVMs.find((item) => item.name === name
      && (item.namespace || item.object?.metadata?.namespace || '') === namespace);
    if (!vm) throw new Error('目标虚拟机已不存在，请刷新资源列表。');
    setTimeout(() => {
      vm.status = action === 'start' ? 'Running' : 'Stopped';
      if (vm.object) vm.object.status = { ...vm.object.status, ready: action === 'start', printableStatus: vm.status };
    }, 350);
    return;
  }
  try {
    await request(targetVirtualMachineActionUrl(namespace, name, action), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } catch (error) {
    targetVirtualMachineError(error, namespace, action === 'start' ? '启动' : '关闭');
  }
}

export async function deleteTargetVirtualMachine(namespace: string, name: string): Promise<void> {
  if (config.mode === 'mock') {
    const index = mockTargetInventoryVMs.findIndex((item) => item.name === name
      && (item.namespace || item.object?.metadata?.namespace || '') === namespace);
    if (index < 0) throw new Error('目标虚拟机已不存在，请刷新资源列表。');
    setTimeout(() => {
      const currentIndex = mockTargetInventoryVMs.findIndex((item) => item.name === name
        && (item.namespace || item.object?.metadata?.namespace || '') === namespace);
      if (currentIndex >= 0) mockTargetInventoryVMs.splice(currentIndex, 1);
    }, 350);
    return;
  }
  try {
    await request(targetVirtualMachineUrl(namespace, name), { method: 'DELETE' });
  } catch (error) {
    targetVirtualMachineError(error, namespace, '删除');
  }
}

export const resources = {
  providers: () => listResource<Provider>('providers'),
  networkMaps: () => listResource<NetworkMap>('networkmaps'),
  storageMaps: () => listResource<StorageMap>('storagemaps'),
  plans: () => listResource<Plan>('plans'),
  migrations: () => listResource<Migration>('migrations'),
  controllers: () => listResource<ForkliftController>('forkliftcontrollers'),
};
