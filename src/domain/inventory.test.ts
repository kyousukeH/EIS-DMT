import { describe, expect, it } from 'vitest';
import { configuredDiskBytes, configuredDisks, inventoryPowerPresentation, inventoryPowerState, inventoryResourceKey, isVMwareToolsConcern, migratedTargetVMs, parseKubernetesQuantity, targetVMKey, vmsUsingResource } from './inventory';
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

  it('classifies PVC-backed KubeVirt disks by boot order', () => {
    const disks = configuredDisks({
      id: 'target', name: 'target', object: { spec: { template: { spec: {
        domain: { devices: { disks: [{ name: 'data' }, { name: 'root', bootOrder: 1 }] } },
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: 'app-data' } },
          { name: 'root', dataVolume: { name: 'app-root' } },
        ],
      } } } },
    });
    expect(disks).toEqual([
      expect.objectContaining({ name: 'data', claimName: 'app-data', role: 'data' }),
      expect.objectContaining({ name: 'root', claimName: 'app-root', role: 'system', bootOrder: 1 }),
    ]);
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
    expect(inventoryPowerState({ id: 'd', name: 'd', status: 'Starting' })).toBe('starting');
    expect(inventoryPowerPresentation({ id: 'e', name: 'e', status: 'Stopping' })).toMatchObject({ label: '关机中', transitional: true });
    expect(inventoryPowerPresentation({ id: 'f', name: 'f', status: 'WaitingForVolumeBinding' })).toMatchObject({ label: '等待磁盘就绪', tone: 'warning' });
  });

  it('recognizes VMware Tools validation concerns from controller identifiers and messages', () => {
    expect(isVMwareToolsConcern({ id: 'GuestToolsIssue', category: 'Critical' })).toBe(true);
    expect(isVMwareToolsConcern({ category: 'Critical', message: 'VMware Tools issues detected.' })).toBe(true);
    expect(isVMwareToolsConcern({ category: 'Critical', label: '不支持的磁盘控制器' })).toBe(false);
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
    expect(migratedTargetVMs([plan], 'host').get(targetVMKey('apps', 'app-01'))).toMatchObject({ planName: 'wave-1', sourceProvider: 'vcenter', confidence: 'inferred' });
  });

  it('keeps the latest successful task when the same target name is migrated again', () => {
    const completedPlan = (name: string, uid: string, completed: string): Plan => ({
      apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
      metadata: { name, uid, creationTimestamp: completed },
      spec: {
        targetNamespace: 'apps', provider: { source: { name: 'vcenter' }, destination: { name: 'host' } },
        map: { network: { name: 'net' }, storage: { name: 'storage' } }, vms: [{ id: 'vm-1' }],
        skipGuestConversion: false, runPreflightInspection: true,
      },
      status: {
        conditions: [{ type: 'Succeeded', status: 'True' }],
        migration: { completed, vms: [{ id: 'vm-1', name: 'app-01', completed }] },
      },
    });
    const oldTask = completedPlan('wave-old', 'uid-old', '2026-01-01T00:00:00Z');
    const latestTask = completedPlan('wave-latest', 'uid-latest', '2026-02-01T00:00:00Z');

    expect(migratedTargetVMs([latestTask, oldTask], 'host').get(targetVMKey('apps', 'app-01'))?.planName).toBe('wave-latest');
    expect(migratedTargetVMs([oldTask, latestTask], 'host').get(targetVMKey('apps', 'app-01'))?.planName).toBe('wave-latest');
  });

  it('prefers the task label carried by the current target virtual machine', () => {
    const task = (name: string, uid: string, completed: string): Plan => ({
      apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan', metadata: { name, uid },
      spec: {
        targetNamespace: 'apps', provider: { source: { name: 'vcenter' }, destination: { name: 'host' } },
        map: { network: { name: 'net' }, storage: { name: 'storage' } }, vms: [{ id: 'vm-1' }],
        skipGuestConversion: false, runPreflightInspection: true,
      },
      status: {
        conditions: [{ type: 'Succeeded', status: 'True' }],
        migration: { completed, vms: [{ id: 'vm-1', name: 'app-01', completed }] },
      },
    });
    const oldTask = task('wave-old', 'uid-old', '2026-03-01T00:00:00Z');
    const recreatedBy = task('wave-recreated', 'uid-recreated', '2026-02-01T00:00:00Z');
    const targetVM: InventoryVM = {
      id: 'target-app', name: 'app-01', namespace: 'apps',
      object: { metadata: { namespace: 'apps', labels: { 'plan-name': 'wave-recreated', plan: 'uid-recreated' } } },
    };

    expect(migratedTargetVMs([oldTask, recreatedBy], 'host', [targetVM]).get(targetVMKey('apps', 'app-01'))?.planName).toBe('wave-recreated');
    expect(migratedTargetVMs([oldTask, recreatedBy], 'host', [targetVM]).get(targetVMKey('apps', 'app-01'))?.confidence).toBe('confirmed');
  });

  it('does not associate a newly recreated same-name virtual machine with an old task', () => {
    const oldTask = {
      apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan', metadata: { name: 'wave-old', uid: 'uid-old', creationTimestamp: '2026-01-01T00:00:00Z' },
      spec: {
        targetNamespace: 'apps', provider: { source: { name: 'vcenter' }, destination: { name: 'host' } },
        map: { network: { name: 'net' }, storage: { name: 'storage' } }, vms: [{ id: 'vm-1' }],
        skipGuestConversion: false, runPreflightInspection: true,
      },
      status: { conditions: [{ type: 'Succeeded', status: 'True' }], migration: { started: '2026-01-01T01:00:00Z', completed: '2026-01-01T02:00:00Z', vms: [{ id: 'vm-1', name: 'app-01', completed: '2026-01-01T02:00:00Z' }] } },
    } as Plan;
    const recreated: InventoryVM = {
      id: 'new-vm', name: 'app-01', namespace: 'apps',
      object: { metadata: { namespace: 'apps', creationTimestamp: '2026-10-01T00:00:00Z' } },
    };

    expect(migratedTargetVMs([oldTask], 'host', [recreated]).has(targetVMKey('apps', 'app-01'))).toBe(false);
  });
});
