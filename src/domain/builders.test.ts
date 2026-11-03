import { describe, expect, it } from 'vitest';
import { buildNetworkMap, buildPlan, buildStorageMap, buildValidationPatch } from './builders';
import type { NetworkMap, Provider } from './types';

const provider = (name: string, type: Provider['spec']['type']): Provider => ({
  apiVersion: 'forklift.konveyor.io/v1beta1',
  kind: 'Provider',
  metadata: { name, namespace: 'konveyor-forklift', uid: `${name}-uid` },
  spec: { type },
});

const source = provider('vcenter', 'vsphere');
const destination = provider('host', 'openshift');
const networkMap: NetworkMap = {
  apiVersion: 'forklift.konveyor.io/v1beta1',
  kind: 'NetworkMap',
  metadata: { name: 'network-map', namespace: 'konveyor-forklift' },
  spec: { provider: { source: {}, destination: {} } as never, map: [] },
};

describe('resource builders', () => {
  it('writes conversion and preflight switches explicitly to the Plan CR', () => {
    const storageMap = buildStorageMap({
      name: 'storage-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [{ sourceId: 'datastore-1', storageClass: 'ceph-rbd' }],
    });
    const plan = buildPlan({
      name: 'plan-a', namespace: 'konveyor-forklift', targetNamespace: 'workloads', type: 'cold',
      source, destination, networkMap, storageMap, vmIds: ['vm-1'], skipGuestConversion: false,
      runPreflightInspection: false, targetPowerState: 'auto', preserveStaticIPs: true,
    });
    expect(plan.spec.skipGuestConversion).toBe(false);
    expect(plan.spec.runPreflightInspection).toBe(false);
  });

  it('writes both current and compatible warm migration fields', () => {
    const storageMap = buildStorageMap({
      name: 'storage-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [{ sourceId: 'datastore-1', storageClass: 'ceph-rbd' }],
    });
    const plan = buildPlan({
      name: 'plan-warm', namespace: 'konveyor-forklift', targetNamespace: 'workloads', type: 'warm',
      source, destination, networkMap, storageMap, vmIds: ['vm-1'], skipGuestConversion: false,
      runPreflightInspection: true, targetPowerState: 'auto', preserveStaticIPs: true,
    });

    expect(plan.spec.type).toBe('warm');
    expect(plan.spec.warm).toBe(true);
  });

  it('writes the VMware Tools compatibility option only for selected virtual machines', () => {
    const storageMap = buildStorageMap({
      name: 'storage-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [{ sourceId: 'datastore-1', storageClass: 'ceph-rbd' }],
    });
    const plan = buildPlan({
      name: 'plan-tools', namespace: 'konveyor-forklift', targetNamespace: 'workloads', type: 'cold',
      source, destination, networkMap, storageMap, vmIds: ['vm-1', 'vm-2'],
      skipVMwareToolsVMIds: ['vm-2'], skipGuestConversion: false,
      runPreflightInspection: true, targetPowerState: 'auto', preserveStaticIPs: true,
    });

    expect(plan.spec.vms).toEqual([
      { id: 'vm-1', skipVMwareTools: false },
      { id: 'vm-2', skipVMwareTools: true },
    ]);
    expect(plan.spec.type).toBe('cold');
  });

  it('writes defaults while allowing each storage pair to choose its own modes', () => {
    const map = buildStorageMap({
      name: 'storage-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [
        { sourceId: 'datastore-1', storageClass: 'ceph-rbd' },
        { sourceId: 'datastore-2', storageClass: 'cephfs', volumeMode: 'Filesystem', accessMode: 'ReadWriteOnce' },
      ],
    });
    expect(map.spec.map).toHaveLength(2);
    expect(map.spec.map[0].destination).toEqual({
      storageClass: 'ceph-rbd', volumeMode: 'Block', accessMode: 'ReadWriteMany',
    });
    expect(map.spec.map[1].destination).toEqual({
      storageClass: 'cephfs', volumeMode: 'Filesystem', accessMode: 'ReadWriteOnce',
    });
  });

  it('writes namespaced KubeVirt source storage references', () => {
    const kubeVirtSource = { ...provider('remote-kubevirt', 'openshift'), spec: { type: 'openshift' as const, url: 'https://remote.example:6443' } };
    const map = buildStorageMap({
      name: 'kubevirt-storage', namespace: 'konveyor-forklift', source: kubeVirtSource, destination,
      pairs: [{ sourceId: '', sourceName: 'fast-rbd', sourceNamespace: 'apps', storageClass: 'ceph-rbd' }],
    });
    expect(map.spec.map[0].source).toEqual({ name: 'fast-rbd', namespace: 'apps' });
  });

  it('omits IP handling from default and disconnected network destinations', () => {
    const map = buildNetworkMap({
      name: 'network-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [
        { source: { id: 'network-1' }, destination: { type: 'pod' }, networkIPMode: 'dhcp' },
        { source: { id: 'network-2' }, destination: { type: 'ignored' }, networkIPMode: 'preserve' },
        { source: { id: 'network-3' }, destination: { type: 'multus', namespace: 'apps', name: 'business' }, networkIPMode: 'preserve' },
      ],
    });

    expect(map.spec.map[0]).not.toHaveProperty('networkIPMode');
    expect(map.spec.map[1]).not.toHaveProperty('networkIPMode');
    expect(map.spec.map[2].networkIPMode).toBe('preserve');

    const storageMap = buildStorageMap({
      name: 'storage-map', namespace: 'konveyor-forklift', source, destination,
      pairs: [{ sourceId: 'datastore-1', storageClass: 'ceph-rbd' }],
    });
    const plan = buildPlan({
      name: 'pod-static-ip', namespace: 'konveyor-forklift', targetNamespace: 'workloads', type: 'cold',
      source, destination, networkMap: map, storageMap, vmIds: ['vm-1'], skipGuestConversion: false,
      runPreflightInspection: true, targetPowerState: 'auto', preserveStaticIPs: true,
    });
    expect(plan.spec.preserveStaticIPs).toBe(true);
  });

  it('uses the exact ForkliftController validation field', () => {
    expect(buildValidationPatch(false)).toEqual({ spec: { feature_validation: 'false' } });
  });
});
