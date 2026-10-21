import { afterEach, describe, expect, it, vi } from 'vitest';
import { listInventoryVMs, loadRuntimeConfig } from './client';
import type { Provider, RuntimeConfig } from '../domain/types';

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
});
