import type { InventoryConcern, InventoryDisk, InventoryResource, InventoryVM, Plan, ProviderType } from './types';
import { getPlanStatus } from './status';

const KiB = 1024;
const MiB = KiB ** 2;
const GiB = KiB ** 3;

export function isVMwareToolsConcern(concern: InventoryConcern): boolean {
  const text = [concern.id, concern.label, concern.assessment, concern.message].filter(Boolean).join(' ');
  return /vmware\s*tools|guest\s*tools|guesttools|guest-tools|客户机工具|虚拟机工具/i.test(text);
}

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

export function configuredDiskCapacityBytes(disk: InventoryDisk): number {
  return (disk.diskSizeBytes || 0)
    + (!disk.diskSizeBytes && disk.diskSizeMib ? disk.diskSizeMib * MiB : 0)
    + (!disk.diskSizeBytes && !disk.diskSizeMib && disk.provisionedSize ? disk.provisionedSize : 0)
    + (!disk.diskSizeBytes && !disk.diskSizeMib && !disk.provisionedSize && disk.capacity
      ? ovfCapacity(disk.capacity, disk.capacityAllocationUnits) : 0);
}

function withDiskRoles(disks: InventoryDisk[]): InventoryDisk[] {
  if (disks.length === 0 || disks.some((disk) => disk.role === 'system')) return disks;
  const explicitBootOrders = disks.map((disk) => disk.bootOrder).filter((value): value is number => value !== undefined);
  const systemIndex = explicitBootOrders.length
    ? disks.findIndex((disk) => disk.bootOrder === Math.min(...explicitBootOrders))
    : 0;
  return disks.map((disk, index) => ({ ...disk, role: index === systemIndex ? 'system' : 'data' }));
}

export function configuredDisks(vm: InventoryVM): InventoryDisk[] {
  if ((vm.disks || []).length > 0) return withDiskRoles(vm.disks || []);

  const devices = vm.object?.spec?.template?.spec?.domain?.devices?.disks || [];
  const templates = vm.object?.spec?.dataVolumeTemplates || [];
  if (templates.length > 0) return withDiskRoles(templates.map((template) => {
    const name = template.metadata?.name;
    const device = devices.find((item) => item.name === name);
    const request = template.spec?.storage?.resources?.requests?.storage
      || template.spec?.pvc?.resources?.requests?.storage;
    return {
      name,
      claimName: name,
      bootOrder: device?.bootOrder,
      capacity: parseKubernetesQuantity(request),
      storageClassName: template.spec?.storage?.storageClassName || template.spec?.pvc?.storageClassName,
    };
  }));

  const volumes = vm.object?.spec?.template?.spec?.volumes || [];
  return withDiskRoles(volumes.flatMap((volume) => {
    const claimName = volume.persistentVolumeClaim?.claimName || volume.dataVolume?.name;
    if (!claimName) return [];
    const device = devices.find((item) => item.name === volume.name);
    return [{ name: volume.name, claimName, bootOrder: device?.bootOrder }];
  }));
}

export function configuredDiskBytes(vm: InventoryVM): number {
  const disks = configuredDisks(vm);
  const diskBytes = disks.reduce((total, disk) => total + configuredDiskCapacityBytes(disk), 0);
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
  const directState = vm.object?.status?.printableStatus || vm.status || vm.powerState;
  if (/starting/i.test(directState || '')) return 'starting';
  if (/provisioning/i.test(directState || '')) return 'provisioning';
  if (/waiting.*volume|waitingforvolumebinding/i.test(directState || '')) return 'waitingForVolume';
  if (/stopping/i.test(directState || '')) return 'stopping';
  if (/terminating|deleting/i.test(directState || '')) return 'terminating';
  if (/migrating/i.test(directState || '')) return 'migrating';
  if (/paused/i.test(directState || '')) return 'paused';
  if (/pvcnotfound/i.test(directState || '')) return 'pvcNotFound';
  if (/datavolumeerror/i.test(directState || '')) return 'dataVolumeError';
  if (/unschedulable/i.test(directState || '')) return 'unschedulable';
  if (/crash|error|imagepull/i.test(directState || '')) return 'error';
  if (/poweredOn|running|up/i.test(directState || '')) return 'poweredOn';
  if (/poweredOff|stopped|down|halted/i.test(directState || '')) return 'poweredOff';
  if (directState) return directState;
  const status = vm.object?.status;
  if (status?.ready || status?.printableStatus === 'Running') return 'poweredOn';
  return status?.printableStatus;
}

export interface InventoryPowerPresentation {
  state: string;
  label: string;
  tone: 'running' | 'pending' | 'warning' | 'danger';
  transitional: boolean;
}

export function inventoryPowerPresentation(vm: InventoryVM): InventoryPowerPresentation {
  const state = inventoryPowerState(vm) || 'unknown';
  const presentations: Record<string, Omit<InventoryPowerPresentation, 'state'>> = {
    poweredOn: { label: '运行中', tone: 'running', transitional: false },
    poweredOff: { label: '已关机', tone: 'pending', transitional: false },
    starting: { label: '启动中', tone: 'running', transitional: true },
    provisioning: { label: '正在准备资源', tone: 'running', transitional: true },
    waitingForVolume: { label: '等待磁盘就绪', tone: 'warning', transitional: true },
    stopping: { label: '关机中', tone: 'running', transitional: true },
    terminating: { label: '删除中', tone: 'warning', transitional: true },
    migrating: { label: '运行位置调整中', tone: 'running', transitional: true },
    paused: { label: '已暂停', tone: 'warning', transitional: false },
    pvcNotFound: { label: '磁盘未找到', tone: 'danger', transitional: false },
    dataVolumeError: { label: '磁盘准备失败', tone: 'danger', transitional: false },
    unschedulable: { label: '无法调度', tone: 'danger', transitional: false },
    error: { label: '运行异常', tone: 'danger', transitional: false },
    unknown: { label: '状态确认中', tone: 'pending', transitional: true },
  };
  return { state, ...(presentations[state] || { label: String(state), tone: 'pending' as const, transitional: true }) };
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
  confidence: 'confirmed' | 'inferred';
}

function migrationTimestamp(plan: Plan, completed?: string): number {
  const historyTimes = (plan.status?.migration?.history || []).flatMap((entry) => [entry.completed, entry.started]);
  const timestamps = [
    completed,
    plan.status?.migration?.completed,
    ...historyTimes,
    plan.status?.migration?.started,
    plan.metadata.creationTimestamp,
  ].map((value) => Date.parse(value || '')).filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
}

function targetPlanLabels(vm: InventoryVM): Record<string, string> {
  return vm.object?.metadata?.labels || {};
}

export function migratedTargetVMs(
  plans: Plan[],
  destinationProvider: string,
  targetVMs: InventoryVM[] = [],
): Map<string, MigratedTargetVM> {
  const historical = new Map<string, MigratedTargetVM>();
  const timestamps = new Map<string, number>();
  const destinationPlans = plans.filter((plan) => plan.spec.provider.destination.name === destinationProvider);
  destinationPlans
    .forEach((plan) => {
      const planSucceeded = getPlanStatus(plan).tone === 'success';
      plan.spec.vms.forEach((plannedVM) => {
        const statusVM = plan.status?.migration?.vms?.find((vm) => vm.id === plannedVM.id);
        const vmSucceeded = Boolean(statusVM?.completed || /Completed|Succeeded/i.test(statusVM?.phase || ''));
        const targetName = statusVM?.targetName || plannedVM.targetName || statusVM?.name || plannedVM.name;
        if (!targetName || (!planSucceeded && !vmSucceeded)) return;
        const key = targetVMKey(plan.spec.targetNamespace, targetName);
        const completed = statusVM?.completed || plan.status?.migration?.completed;
        const occurredAt = migrationTimestamp(plan, completed);
        if (historical.has(key) && occurredAt <= (timestamps.get(key) ?? Number.NEGATIVE_INFINITY)) return;
        historical.set(key, {
          planName: plan.metadata.name,
          sourceProvider: plan.spec.provider.source.name,
          completed,
          confidence: 'inferred',
        });
        timestamps.set(key, occurredAt);
      });
    });

  if (targetVMs.length === 0) return historical;

  const migrated = new Map<string, MigratedTargetVM>();
  const plansByName = new Map(destinationPlans.map((plan) => [plan.metadata.name, plan]));
  const plansByUid = new Map(destinationPlans.filter((plan) => plan.metadata.uid).map((plan) => [plan.metadata.uid, plan]));
  targetVMs.forEach((vm) => {
    const labels = targetPlanLabels(vm);
    const labeledPlanName = labels['eis-dmt.io/plan-name'] || labels['migration.konveyor.io/plan-name'] || labels['plan-name'];
    const labeledPlan = (labeledPlanName && plansByName.get(labeledPlanName))
      || (labels.plan && plansByUid.get(labels.plan));
    const key = targetVMKey(inventoryVMNamespace(vm), vm.name);
    if (labeledPlan) {
      migrated.set(key, {
        planName: labeledPlan.metadata.name,
        sourceProvider: labeledPlan.spec.provider.source.name,
        completed: labeledPlan.status?.migration?.completed,
        confidence: 'confirmed',
      });
      return;
    }

    const inferred = historical.get(key);
    const creationTime = Date.parse(vm.object?.metadata?.creationTimestamp || '');
    const inferredPlan = inferred && plansByName.get(inferred.planName);
    const started = Date.parse(inferredPlan?.status?.migration?.started || inferredPlan?.metadata.creationTimestamp || '');
    const completed = Date.parse(inferredPlan?.status?.migration?.completed || '');
    const tolerance = 5 * 60_000;
    if (inferred && Number.isFinite(creationTime) && Number.isFinite(started)
      && creationTime >= started - tolerance
      && (!Number.isFinite(completed) || creationTime <= completed + tolerance)) {
      migrated.set(key, inferred);
    }
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
