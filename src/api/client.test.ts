import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteTargetVirtualMachine, listInventoryVMs, loadRuntimeConfig, rollbackPlanResources, setTargetVirtualMachinePower } from './client';
import type { Plan, Provider, RuntimeConfig } from '../domain/types';

const config: RuntimeConfig = {
  mode: 'cluster',
  namespace: 'konveyor-forklift',
  inventoryEnabled: true,
  defaultStorageClass: 'default',
  defaultVolumeMode: 'Filesystem',
  defaultAccessMode: 'ReadWriteOnce',
  version: 'test',
};

function provider(type: Provider['spec']['type'], name: string, uid: string, url?: string): Provider {
  return {
    apiVersion: 'forklift.konveyor.io/v1beta1',
    kind: 'Provider',
    metadata: { name, uid, namespace: config.namespace },
    spec: { type, url },
  };
}

describe('inventory VM requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('queries all namespaces for the EIS target and keeps source inventory scoped', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input) === '/api/config' ? config : [],
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await loadRuntimeConfig();
    await listInventoryVMs(provider('openshift', 'host', 'target-uid', ''));
    await listInventoryVMs(provider('vsphere', 'vcenter', 'source-uid', 'https://vcenter.example/sdk'));

    expect(fetchMock.mock.calls[1][0]).toBe('/api/inventory/providers/openshift/target-uid/vms?detail=1');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/inventory/providers/vsphere/source-uid/vms?detail=1&namespace=konveyor-forklift');
  });

  it('enriches local target disks from referenced PVC requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url === '/api/config'
        ? config
        : url.includes('/api/inventory/')
          ? [{
            id: 'target-1', name: 'app-01', namespace: 'apps', status: 'Starting',
            object: { metadata: { namespace: 'apps' }, spec: { template: { spec: {
              domain: { devices: { disks: [{ name: 'root', bootOrder: 1 }, { name: 'data' }] } },
              volumes: [
                { name: 'root', persistentVolumeClaim: { claimName: 'app-root' } },
                { name: 'data', dataVolume: { name: 'app-data' } },
              ],
            } } } },
          }]
          : { items: [
            { metadata: { name: 'app-root', namespace: 'apps' }, spec: { storageClassName: 'ceph-rbd', volumeMode: 'Block', accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '120Gi' } } } },
            { metadata: { name: 'app-data', namespace: 'apps' }, spec: { storageClassName: 'ceph-rbd', volumeMode: 'Block', accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '400Gi' } } } },
          ] };
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadRuntimeConfig();
    const vms = await listInventoryVMs(provider('openshift', 'host', 'target-uid', ''));

    expect(fetchMock.mock.calls[2][0]).toBe('/api/k8s/api/v1/namespaces/apps/persistentvolumeclaims');
    expect(vms[0].disks).toEqual([
      expect.objectContaining({ claimName: 'app-root', capacity: 120 * 1024 ** 3, role: 'system', storageClassName: 'ceph-rbd' }),
      expect.objectContaining({ claimName: 'app-data', capacity: 400 * 1024 ** 3, role: 'data', storageClassName: 'ceph-rbd' }),
    ]);
  });
});

describe('target virtual machine operations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the target namespace for start, stop, and delete requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: String(input) === '/api/config' ? 200 : 204,
      json: async () => String(input) === '/api/config' ? config : { method: init?.method },
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await loadRuntimeConfig();
    await setTargetVirtualMachinePower('business-apps', 'erp-01', 'start');
    await setTargetVirtualMachinePower('business-apps', 'erp-01', 'stop');
    await deleteTargetVirtualMachine('business-apps', 'erp-01');

    expect(fetchMock.mock.calls[1][0]).toBe('/api/k8s/apis/subresources.kubevirt.io/v1/namespaces/business-apps/virtualmachines/erp-01/start');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/k8s/apis/subresources.kubevirt.io/v1/namespaces/business-apps/virtualmachines/erp-01/stop');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/k8s/apis/kubevirt.io/v1/namespaces/business-apps/virtualmachines/erp-01');
    expect(fetchMock.mock.calls[3][1]?.method).toBe('DELETE');
  });
});

const rollbackPlan: Plan = {
  apiVersion: 'forklift.konveyor.io/v1beta1',
  kind: 'Plan',
  metadata: { name: 'rollback-test', namespace: config.namespace, uid: 'plan-uid' },
  spec: {
    targetNamespace: 'target-workloads',
    provider: { source: { name: 'source' }, destination: { name: 'host' } },
    map: { network: { name: 'network' }, storage: { name: 'storage' } },
    vms: [{ id: 'vm-1' }],
    skipGuestConversion: false,
    runPreflightInspection: true,
  },
};

describe('rollback cleanup', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes labeled collections without listing target namespace resources', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return {
        ok: true,
        status: 200,
        json: async () => String(input) === '/api/config' ? config : {},
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadRuntimeConfig();
    const result = await rollbackPlanResources(rollbackPlan);

    const cleanupCalls = fetchMock.mock.calls.slice(1, 5);
    expect(cleanupCalls).toHaveLength(4);
    expect(cleanupCalls.every(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(cleanupCalls.every(([url]) => String(url).includes('labelSelector=plan%3Dplan-uid'))).toBe(true);
    expect(fetchMock.mock.calls.slice(1).every(([, init]) => init?.method === 'DELETE' || init?.method === 'PATCH')).toBe(true);
    expect(result.cleanupRequested).toEqual({
      pods: true,
      virtualMachines: true,
      dataVolumes: true,
      persistentVolumeClaims: true,
    });
  });

  it('explains missing target cleanup permission in user-facing language', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/config') return { ok: true, status: 200, json: async () => config } as Response;
      if (init?.method === 'DELETE' && String(input).includes('/pods?')) {
        return { ok: false, status: 403, json: async () => ({ message: 'pods is forbidden' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadRuntimeConfig();
    await expect(rollbackPlanResources(rollbackPlan)).rejects.toThrow('控制台没有清理目标资源空间“target-workloads”中数据传输任务的权限');
  });
});
