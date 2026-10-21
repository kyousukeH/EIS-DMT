import type {
  ForkliftController,
  InventoryNamespace,
  InventoryResource,
  InventoryVM,
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
import { sourceStoragePath } from '../domain/inventory';
import { isEISTargetProvider } from '../domain/providers';

export type ForkliftResource = 'providers' | 'networkmaps' | 'storagemaps' | 'plans' | 'migrations' | 'forkliftcontrollers';

let config: RuntimeConfig;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(detail.message || detail.reason || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
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
    (mockStore[resource] as unknown as T[]).push(structuredClone(body));
    return structuredClone(body);
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

export async function listInventoryVMs(provider: Provider): Promise<InventoryVM[]> {
  if (config.mode === 'mock') return structuredClone(isEISTargetProvider(provider) ? mockTargetInventoryVMs : mockInventoryVMs);
  if (!provider.metadata.uid) return [];
  const params = new URLSearchParams({ detail: '1' });
  // Host-provider VM inventory is cluster-wide unless a namespace is requested.
  // The console namespace is not where migrated workloads are usually created.
  if (!isEISTargetProvider(provider)) params.set('namespace', config.namespace);
  return request<InventoryVM[]>(
    `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/vms?${params.toString()}`,
  );
}

function inventoryProviderUrl(provider: Provider, resource: string) {
  if (!provider.metadata.uid) return undefined;
  return `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/${resource}?detail=1&namespace=${encodeURIComponent(config.namespace)}`;
}

export async function listInventoryNetworks(provider: Provider, role: 'source' | 'target'): Promise<InventoryResource[]> {
  if (config.mode === 'mock') {
    return structuredClone(role === 'source' ? mockSourceNetworks : mockTargetNetworks);
  }
  const path = provider.spec.type === 'openshift' ? 'networkattachmentdefinitions' : 'networks';
  const url = inventoryProviderUrl(provider, path);
  if (!url) return [];
  const resources = await request<InventoryResource[]>(url);
  return role === 'source' && provider.spec.type === 'openshift'
    ? [{ id: 'pod', name: 'Pod 网络', type: 'pod' }, ...resources]
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
    `/api/inventory/providers/${provider.spec.type}/${provider.metadata.uid}/namespaces?namespace=${encodeURIComponent(config.namespace)}`,
  );
}

export const resources = {
  providers: () => listResource<Provider>('providers'),
  networkMaps: () => listResource<NetworkMap>('networkmaps'),
  storageMaps: () => listResource<StorageMap>('storagemaps'),
  plans: () => listResource<Plan>('plans'),
  migrations: () => listResource<Migration>('migrations'),
  controllers: () => listResource<ForkliftController>('forkliftcontrollers'),
};
