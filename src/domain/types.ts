export type ProviderType =
  | 'vsphere'
  | 'ovirt'
  | 'openstack'
  | 'openshift'
  | 'ova'
  | 'ec2'
  | 'hyperv'
  | 'nutanix'
  | 'azure';

export type MigrationType = 'cold' | 'warm' | 'live' | 'conversion';
export type ConditionStatus = 'True' | 'False' | 'Unknown';

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  generation?: number;
  labels?: Record<string, string>;
}

export interface ObjectReference {
  name: string;
  namespace?: string;
  uid?: string;
}

export interface Condition {
  type: string;
  status: ConditionStatus;
  category?: 'Critical' | 'Error' | 'Warn' | 'Advisory' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface KubeList<T> {
  apiVersion?: string;
  kind?: string;
  items: T[];
}

export interface Provider {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'Provider';
  metadata: ObjectMeta;
  spec: {
    type: ProviderType;
    url?: string;
    secret?: ObjectReference;
    settings?: Record<string, string>;
  };
  status?: {
    phase?: string;
    observedGeneration?: number;
    conditions?: Condition[];
  };
}

export interface MappingRef {
  id?: string;
  name?: string;
  namespace?: string;
  type?: string;
}

export interface NetworkMap {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'NetworkMap';
  metadata: ObjectMeta;
  spec: {
    provider: { source: ObjectReference; destination: ObjectReference };
    map: Array<{
      source: MappingRef & { vlan?: string };
      destination: { type: 'pod' | 'multus' | 'ignored'; name?: string; namespace?: string };
      networkIPMode?: 'preserve' | 'dhcp' | 'none';
    }>;
  };
  status?: { observedGeneration?: number; conditions?: Condition[] };
}

export interface StorageMap {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'StorageMap';
  metadata: ObjectMeta;
  spec: {
    provider: { source: ObjectReference; destination: ObjectReference };
    map: Array<{
      source: MappingRef;
      destination: {
        storageClass: string;
        volumeMode: 'Filesystem' | 'Block';
        accessMode: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany';
      };
    }>;
  };
  status?: { observedGeneration?: number; conditions?: Condition[] };
}

export interface Progress {
  total?: number;
  completed?: number;
}

export interface MigrationTask {
  name: string;
  description?: string;
  phase?: string;
  reason?: string;
  started?: string;
  completed?: string;
  progress?: Progress;
  error?: { phase?: string; reasons?: string[] };
  warning?: { phase?: string; reasons?: string[] };
}

export interface MigrationStep extends MigrationTask {
  tasks?: MigrationTask[];
}

export interface PlanVM {
  id: string;
  name?: string;
  targetName?: string;
  warm?: boolean;
  xfsCompatibility?: boolean;
  hooks?: Array<{ step: string; hook: ObjectReference }>;
}

export interface VMStatus extends Omit<PlanVM, 'warm'> {
  phase?: string;
  started?: string;
  completed?: string;
  pipeline?: MigrationStep[];
  error?: { phase?: string; reasons?: string[] };
  conditions?: Condition[];
  warm?: {
    successes?: number;
    failures?: number;
    nextPrecopyAt?: string;
    precopies?: Array<{ start?: string; end?: string; snapshot?: string }>;
  };
}

export interface Plan {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'Plan';
  metadata: ObjectMeta;
  spec: {
    description?: string;
    targetNamespace: string;
    type?: MigrationType;
    warm?: boolean;
    provider: { source: ObjectReference; destination: ObjectReference };
    map: { network: ObjectReference; storage: ObjectReference };
    vms: PlanVM[];
    skipGuestConversion: boolean;
    runPreflightInspection: boolean;
    targetPowerState?: 'on' | 'off' | 'auto';
    preserveStaticIPs?: boolean;
    transferNetwork?: ObjectReference;
    archived?: boolean;
  };
  status?: {
    observedGeneration?: number;
    conditions?: Condition[];
    migration?: {
      active?: string;
      started?: string;
      completed?: string;
      vms?: VMStatus[];
      history?: Array<{ migration?: ObjectReference; started?: string; completed?: string }>;
    };
  };
}

export interface Migration {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'Migration';
  metadata: ObjectMeta & { generateName?: string };
  spec: {
    plan: ObjectReference;
    cancel?: MappingRef[];
    cutover?: string | null;
    vmCutover?: Array<{ id: string; cutover: string }>;
    resumeConversion?: boolean;
  };
  status?: { conditions?: Condition[] };
}

export interface InventoryConcern {
  id?: string;
  category: 'Critical' | 'Warning' | 'Advisory' | string;
  label?: string;
  assessment?: string;
  message?: string;
}

export interface InventoryVM {
  id: string;
  name: string;
  namespace?: string;
  path?: string;
  powerState?: string;
  status?: string;
  guestName?: string;
  cpuCount?: number;
  memoryMB?: number;
  memory?: number;
  memorySizeMib?: number;
  numSockets?: number;
  numVcpusPerSocket?: number;
  numThreadsPerCore?: number;
  storageUsed?: number;
  disks?: InventoryDisk[];
  networks?: InventoryResourceRef[];
  nics?: InventoryNIC[];
  diskAttachments?: Array<{ disk?: string; id?: string }>;
  addresses?: Record<string, unknown>;
  object?: InventoryKubeVirtVM;
  concerns?: InventoryConcern[];
}

export interface InventoryResourceRef {
  id?: string;
  uid?: string;
  name?: string;
  namespace?: string;
  type?: string;
  kind?: string;
}

export interface InventoryDisk {
  id?: string;
  name?: string;
  capacity?: number;
  provisionedSize?: number;
  diskSizeBytes?: number;
  diskSizeMib?: number;
  capacityAllocationUnits?: string;
  datastore?: InventoryResourceRef;
  storageDomain?: string;
  storageContainerUuid?: string;
  storageContainerName?: string;
}

export interface InventoryNIC {
  network?: InventoryResourceRef | string;
  networkName?: string;
  subnetUuid?: string;
  subnetName?: string;
  profile?: string;
}

export interface InventoryKubeVirtVM {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    dataVolumeTemplates?: Array<{
      metadata?: { name?: string };
      spec?: {
        pvc?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
        storage?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
      };
    }>;
    template?: {
      spec?: {
        domain?: {
          cpu?: { cores?: number; sockets?: number; threads?: number };
          memory?: { guest?: string };
          resources?: { requests?: { memory?: string } };
        };
        networks?: Array<{
          name?: string;
          pod?: object;
          multus?: { networkName?: string };
        }>;
        volumes?: Array<{
          name?: string;
          dataVolume?: { name?: string };
          persistentVolumeClaim?: { claimName?: string };
        }>;
      };
    };
  };
  status?: { printableStatus?: string; ready?: boolean };
}

export interface InventoryResource {
  id?: string;
  uid?: string;
  name: string;
  namespace?: string;
  path?: string;
  type?: string;
  selfLink?: string;
  object?: {
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
    provisioner?: string;
  };
}

export interface InventoryNamespace {
  name: string;
  selfLink?: string;
}

export interface RuntimeConfig {
  mode: 'mock' | 'cluster';
  namespace: string;
  inventoryEnabled: boolean;
  defaultStorageClass: string;
  defaultVolumeMode: 'Block' | 'Filesystem';
  defaultAccessMode: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany';
  version: string;
}

export interface ForkliftController {
  apiVersion: 'forklift.konveyor.io/v1beta1';
  kind: 'ForkliftController';
  metadata: ObjectMeta;
  spec: Record<string, unknown> & { feature_validation?: string };
  status?: { conditions?: Condition[] };
}
