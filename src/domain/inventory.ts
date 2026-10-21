import type { InventoryResource, InventoryVM, Plan, ProviderType } from './types';
import { getPlanStatus } from './status';

const KiB = 1024;
const MiB = KiB ** 2;
const GiB = KiB ** 3;

export function parseKubernetesQuantity(value?: string): number {
  if (!value) return 0;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)([EPTGMK]i?|m)?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const suffix = match[2] || '';
  const binary: Record<string, number> = { Ki: KiB, Mi: MiB, Gi: GiB, Ti: GiB * KiB, Pi: GiB * MiB, Ei: GiB * GiB };
  const decimal: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3 };
  return amount * (binary[suffix] || decimal[suffix] || 1);
}

function ovfCapacity(capacity: number, units?: string) {
  if (!units) return capacity;
  const power = units.match(/2\^(\d+)/)?.[1];
  return power ? capacity * (2 ** Number(power)) : capacity;
}

export function configuredDiskBytes(vm: InventoryVM): number {
  const disks = vm.disks || [];
  const diskBytes = disks.reduce((total, disk) => total
    + (disk.diskSizeBytes || 0)
    + (!disk.diskSizeBytes && disk.diskSizeMib ? disk.diskSizeMib * MiB : 0)
    + (!disk.diskSizeBytes && !disk.diskSizeMib && disk.provisionedSize ? disk.provisionedSize : 0)
    + (!disk.diskSizeBytes && !disk.diskSizeMib && !disk.provisionedSize && disk.capacity
      ? ovfCapacity(disk.capacity, disk.capacityAllocationUnits) : 0), 0);
  if (diskBytes > 0) return diskBytes;

  return (vm.object?.spec?.dataVolumeTemplates || []).reduce((total, template) => {
    const request = template.spec?.storage?.resources?.requests?.storage
      || template.spec?.pvc?.resources?.requests?.storage;
    return total + parseKubernetesQuantity(request);
  }, 0);
}

export function inventoryCpuCount(vm: InventoryVM): number | undefined {
  if (vm.cpuCount) return vm.cpuCount;
  if (vm.numSockets || vm.numVcpusPerSocket || vm.numThreadsPerCore) {
    return (vm.numSockets || 1) * (vm.numVcpusPerSocket || 1) * (vm.numThreadsPerCore || 1);
  }
  const cpu = vm.object?.spec?.template?.spec?.domain?.cpu;
  if (!cpu) return undefined;
  return (cpu.sockets || 1) * (cpu.cores || 1) * (cpu.threads || 1);
}

export function inventoryMemoryMB(vm: InventoryVM): number | undefined {
  if (vm.memoryMB) return vm.memoryMB;
  if (vm.memorySizeMib) return vm.memorySizeMib;
  if (vm.memory) return vm.memory / MiB;
  const domain = vm.object?.spec?.template?.spec?.domain;
  const bytes = parseKubernetesQuantity(domain?.memory?.guest || domain?.resources?.requests?.memory);
  return bytes ? bytes / MiB : undefined;
}

export function inventoryPowerState(vm: InventoryVM): string | undefined {
  const directState = vm.powerState || vm.status;
  if (/poweredOn|running|up/i.test(directState || '')) return 'poweredOn';
  if (/poweredOff|stopped|down|halted/i.test(directState || '')) return 'poweredOff';
  if (directState) return directState;
  const status = vm.object?.status;
  if (status?.ready || status?.printableStatus === 'Running') return 'poweredOn';
  return status?.printableStatus;
}

export function inventoryVMNamespace(vm: InventoryVM): string {
  return vm.namespace || vm.object?.metadata?.namespace || '';
}

export function targetVMKey(namespace: string, name: string): string {
  return `${namespace}/${name}`.toLowerCase();
}

export interface MigratedTargetVM {
  planName: string;
  sourceProvider: string;
  completed?: string;
}

export function migratedTargetVMs(plans: Plan[], destinationProvider: string): Map<string, MigratedTargetVM> {
  const migrated = new Map<string, MigratedTargetVM>();
  plans
    .filter((plan) => plan.spec.provider.destination.name === destinationProvider)
    .forEach((plan) => {
      const planSucceeded = getPlanStatus(plan).tone === 'success';
      plan.spec.vms.forEach((plannedVM) => {
        const statusVM = plan.status?.migration?.vms?.find((vm) => vm.id === plannedVM.id);
        const vmSucceeded = Boolean(statusVM?.completed || /Completed|Succeeded/i.test(statusVM?.phase || ''));
        const targetName = statusVM?.targetName || plannedVM.targetName || statusVM?.name || plannedVM.name;
        if (!targetName || (!planSucceeded && !vmSucceeded)) return;
        migrated.set(targetVMKey(plan.spec.targetNamespace, targetName), {
          planName: plan.metadata.name,
          sourceProvider: plan.spec.provider.source.name,
          completed: statusVM?.completed || plan.status?.migration?.completed,
        });
      });
    });
  return migrated;
}

function addRef(refs: Set<string>, value?: string) {
  if (value) refs.add(value.toLowerCase());
}

function addResourceRef(refs: Set<string>, value?: string | { id?: string; uid?: string; name?: string; namespace?: string; type?: string }) {
  if (!value) return;
  if (typeof value === 'string') return addRef(refs, value);
  addRef(refs, value.id);
  addRef(refs, value.uid);
  addRef(refs, value.name);
  addRef(refs, value.namespace && value.name ? `${value.namespace}/${value.name}` : undefined);
  addRef(refs, value.type);
}

export function vmResourceRefs(vm: InventoryVM, kind: 'network' | 'storage'): Set<string> {
  const refs = new Set<string>();
  if (kind === 'network') {
    (vm.networks || []).forEach((network) => addResourceRef(refs, network));
    (vm.nics || []).forEach((nic) => {
      addResourceRef(refs, nic.network);
      addRef(refs, nic.networkName);
      addRef(refs, nic.subnetUuid);
      addRef(refs, nic.subnetName);
    });
    Object.keys(vm.addresses || {}).forEach((name) => addRef(refs, name));
    (vm.object?.spec?.template?.spec?.networks || []).forEach((network) => {
      if (network.pod) addRef(refs, 'pod');
      const name = network.multus?.networkName;
      if (name) {
        addRef(refs, name);
        if (!name.includes('/') && vm.namespace) addRef(refs, `${vm.namespace}/${name}`);
      }
    });
  } else {
    (vm.disks || []).forEach((disk) => {
      addResourceRef(refs, disk.datastore);
      addRef(refs, disk.storageDomain);
      addRef(refs, disk.storageContainerUuid);
      addRef(refs, disk.storageContainerName);
    });
    (vm.object?.spec?.dataVolumeTemplates || []).forEach((template) => {
      addRef(refs, template.spec?.storage?.storageClassName || template.spec?.pvc?.storageClassName);
    });
  }
  return refs;
}

export function resourceAliases(resource: InventoryResource, providerType: ProviderType): string[] {
  const aliases = [resource.id, resource.uid, resource.name, resource.namespace && `${resource.namespace}/${resource.name}`];
  if (providerType === 'openshift' && resource.type === 'pod') aliases.push('pod');
  return aliases.filter(Boolean).map((value) => String(value).toLowerCase());
}

export function vmsUsingResource(vms: InventoryVM[], resource: InventoryResource, kind: 'network' | 'storage', providerType: ProviderType) {
  const aliases = resourceAliases(resource, providerType);
  return vms.filter((vm) => {
    const refs = vmResourceRefs(vm, kind);
    return aliases.some((alias) => refs.has(alias));
  });
}

export function inventoryResourceKey(resource: InventoryResource, providerType: ProviderType) {
  if (providerType === 'openshift') {
    if (resource.type === 'pod') return 'pod';
    return resource.namespace ? `${resource.namespace}/${resource.name}` : resource.name;
  }
  return resource.id || resource.uid || resource.name;
}

export function sourceStoragePath(type: ProviderType) {
  const paths: Partial<Record<ProviderType, string>> = {
    vsphere: 'datastores', ovirt: 'storagedomains', openstack: 'volumetypes', openshift: 'storageclasses',
    ova: 'storages', hyperv: 'storages', nutanix: 'storagecontainers',
  };
  return paths[type] || 'storages';
}
