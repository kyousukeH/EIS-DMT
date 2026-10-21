import { describe, expect, it } from 'vitest';
import { configuredDiskBytes, inventoryPowerState, inventoryResourceKey, migratedTargetVMs, parseKubernetesQuantity, targetVMKey, vmsUsingResource } from './inventory';
import type { InventoryResource, InventoryVM, Plan } from './types';

const GiB = 1024 ** 3;

describe('inventory normalization', () => {
  it('uses configured disk capacity instead of actual storage usage', () => {
    const vm: InventoryVM = {
      id: 'vm-1', name: 'app', storageUsed: 8 * GiB,
      disks: [{ capacity: 120 * GiB }, { capacity: 400 * GiB }],
    };
    expect(configuredDiskBytes(vm)).toBe(520 * GiB);
  });

  it('supports Nutanix, oVirt and KubeVirt capacity fields', () => {
    expect(configuredDiskBytes({ id: 'n', name: 'n', disks: [{ diskSizeMib: 8192 }] })).toBe(8 * GiB);
    expect(configuredDiskBytes({ id: 'o', name: 'o', disks: [{ provisionedSize: 120 * GiB }] })).toBe(120 * GiB);
    expect(configuredDiskBytes({
      id: 'k', name: 'k', object: { spec: { dataVolumeTemplates: [
        { spec: { storage: { resources: { requests: { storage: '120Gi' } } } } },
        { spec: { pvc: { resources: { requests: { storage: '8Gi' } } } } },
      ] } },
    })).toBe(128 * GiB);
    expect(parseKubernetesQuantity('1.5Ti')).toBe(1.5 * 1024 * GiB);
  });

  it('correlates source resources with the virtual machines that use them', () => {
    const vms: InventoryVM[] = [
      { id: 'vm-1', name: 'app', disks: [{ datastore: { id: 'datastore-44' } }], networks: [{ id: 'network-21' }] },
      { id: 'vm-2', name: 'db', disks: [{ datastore: { id: 'datastore-52' } }], networks: [{ id: 'network-21' }] },
    ];
    const network: InventoryResource = { id: 'network-21', name: 'VM Network' };
    const storage: InventoryResource = { id: 'datastore-44', name: 'vsan-prod' };
    expect(vmsUsingResource(vms, network, 'network', 'vsphere').map((vm) => vm.name)).toEqual(['app', 'db']);
    expect(vmsUsingResource(vms, storage, 'storage', 'vsphere').map((vm) => vm.name)).toEqual(['app']);
  });

  it('uses namespaced resource names for KubeVirt source mappings', () => {
    expect(inventoryResourceKey({ uid: 'uid-1', namespace: 'apps', name: 'fast' }, 'openshift')).toBe('apps/fast');
  });

  it('normalizes KubeVirt and source-platform power states', () => {
    expect(inventoryPowerState({ id: 'a', name: 'a', status: 'Running' })).toBe('poweredOn');
    expect(inventoryPowerState({ id: 'b', name: 'b', status: 'Stopped' })).toBe('poweredOff');
    expect(inventoryPowerState({ id: 'c', name: 'c', powerState: 'poweredOn' })).toBe('poweredOn');
  });

  it('identifies target virtual machines created by successful migrations', () => {
    const plan = {
      metadata: { name: 'wave-1' },
      spec: {
        targetNamespace: 'apps', provider: { source: { name: 'vcenter' }, destination: { name: 'host' } },
        map: { network: { name: 'net' }, storage: { name: 'storage' } }, vms: [{ id: 'vm-1' }],
        skipGuestConversion: false, runPreflightInspection: true,
      },
      status: { conditions: [{ type: 'Succeeded', status: 'True' }], migration: { vms: [{ id: 'vm-1', name: 'app-01' }] } },
    } as Plan;
    expect(migratedTargetVMs([plan], 'host').get(targetVMKey('apps', 'app-01'))).toMatchObject({ planName: 'wave-1', sourceProvider: 'vcenter' });
  });
});
