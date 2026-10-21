import type {
  ForkliftController,
  InventoryVM,
  InventoryResource,
  KubeList,
  Migration,
  NetworkMap,
  Plan,
  Provider,
  RuntimeConfig,
  StorageMap,
} from '../domain/types';

export const mockConfig: RuntimeConfig = {
  mode: 'mock',
  namespace: 'konveyor-forklift',
  inventoryEnabled: true,
  defaultStorageClass: 'ocs-storagecluster-ceph-rbd',
  defaultVolumeMode: 'Block',
  defaultAccessMode: 'ReadWriteMany',
  version: '0.1.0-dev',
};

const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const GiB = 1024 ** 3;

export const mockProviders: Provider[] = [
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Provider',
    metadata: { name: 'production-vcenter', namespace: mockConfig.namespace, uid: 'provider-vcenter', creationTimestamp: ago(16000), generation: 2 },
    spec: { type: 'vsphere', url: 'https://vcenter.corp.example/sdk', secret: { name: 'production-vcenter-credentials' }, settings: { vddkInitImage: 'registry.internal/vddk:8.0.3' } },
    status: { phase: 'Ready', observedGeneration: 2, conditions: [
      { type: 'Ready', status: 'True', message: 'Provider is ready' },
      { type: 'ConnectionTestSucceeded', status: 'True' },
      { type: 'InventoryCreated', status: 'True' },
    ] },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Provider',
    metadata: { name: 'host', namespace: mockConfig.namespace, uid: 'provider-host', creationTimestamp: ago(19000), generation: 1 },
    spec: { type: 'openshift', url: '', secret: { name: 'host' } },
    status: { phase: 'Ready', observedGeneration: 1, conditions: [{ type: 'Ready', status: 'True' }] },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Provider',
    metadata: { name: 'legacy-openstack', namespace: mockConfig.namespace, uid: 'provider-openstack', creationTimestamp: ago(9000), generation: 1 },
    spec: { type: 'openstack', url: 'https://keystone.example/v3', secret: { name: 'legacy-openstack-credentials' } },
    status: { phase: 'NotReady', observedGeneration: 1, conditions: [
      { type: 'Ready', status: 'False', category: 'Critical', reason: 'ConnectionTestFailed', message: 'Keystone authentication failed: credentials have expired.' },
    ] },
  },
];

export const mockNetworkMaps: NetworkMap[] = [{
  apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'NetworkMap',
  metadata: { name: 'production-networks', namespace: mockConfig.namespace, creationTimestamp: ago(8000), generation: 3 },
  spec: {
    provider: { source: { name: 'production-vcenter', namespace: mockConfig.namespace }, destination: { name: 'host', namespace: mockConfig.namespace } },
    map: [
      { source: { id: 'network-21', name: 'VM Network' }, destination: { type: 'multus', name: 'prod-vlan-120', namespace: 'vm-workloads' }, networkIPMode: 'preserve' },
      { source: { id: 'network-37', name: 'Backup Network' }, destination: { type: 'multus', name: 'backup-vlan-230', namespace: 'vm-workloads' }, networkIPMode: 'dhcp' },
    ],
  },
  status: { observedGeneration: 3, conditions: [{ type: 'Ready', status: 'True' }] },
}];

export const mockStorageMaps: StorageMap[] = [{
  apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'StorageMap',
  metadata: { name: 'ceph-block-default', namespace: mockConfig.namespace, creationTimestamp: ago(8100), generation: 1 },
  spec: {
    provider: { source: { name: 'production-vcenter', namespace: mockConfig.namespace }, destination: { name: 'host', namespace: mockConfig.namespace } },
    map: [
      { source: { id: 'datastore-44', name: 'vsan-prod' }, destination: { storageClass: 'ocs-storagecluster-ceph-rbd', volumeMode: 'Block', accessMode: 'ReadWriteOnce' } },
      { source: { id: 'datastore-52', name: 'flash-tier' }, destination: { storageClass: 'ocs-storagecluster-ceph-rbd', volumeMode: 'Block', accessMode: 'ReadWriteOnce' } },
    ],
  },
  status: { observedGeneration: 1, conditions: [{ type: 'Ready', status: 'True' }] },
}];

export const mockInventoryVMs: InventoryVM[] = [
  { id: 'vm-101', name: 'erp-app-01', path: '/Production/ERP', powerState: 'poweredOn', guestName: 'Red Hat Enterprise Linux 8', cpuCount: 8, memoryMB: 16384, storageUsed: 318 * GiB, disks: [{ capacity: 120 * GiB, datastore: { id: 'datastore-44' } }, { capacity: 400 * GiB, datastore: { id: 'datastore-52' } }], networks: [{ id: 'network-21' }], concerns: [] },
  { id: 'vm-102', name: 'erp-db-01', path: '/Production/ERP', powerState: 'poweredOn', guestName: 'Red Hat Enterprise Linux 8', cpuCount: 16, memoryMB: 65536, storageUsed: 1280 * GiB, disks: [{ capacity: 120 * GiB, datastore: { id: 'datastore-44' } }, { capacity: 2 * 1024 * GiB, datastore: { id: 'datastore-52' } }], networks: [{ id: 'network-21' }, { id: 'network-37' }], concerns: [{ category: 'Warning', label: '磁盘空间偏低', message: '根分区剩余空间不足，迁移前预检可能失败。' }] },
  { id: 'vm-103', name: 'billing-win-01', path: '/Production/Billing', powerState: 'poweredOff', guestName: 'Microsoft Windows Server 2019', cpuCount: 8, memoryMB: 32768, storageUsed: 720 * GiB, disks: [{ capacity: 120 * GiB, datastore: { id: 'datastore-44' } }, { capacity: 800 * GiB, datastore: { id: 'datastore-52' } }], networks: [{ id: 'network-21' }], concerns: [{ category: 'Advisory', label: '网络设备需要转换', message: '建议保持 skipGuestConversion=false，以安装 VirtIO 网络驱动。' }] },
  { id: 'vm-104', name: 'legacy-router', path: '/Legacy/Network', powerState: 'poweredOff', guestName: 'Other Linux', cpuCount: 4, memoryMB: 8192, storageUsed: 96 * GiB, disks: [{ capacity: 120 * GiB, datastore: { id: 'datastore-44' } }], networks: [{ id: 'network-37' }], concerns: [{ category: 'Critical', label: '不支持的磁盘控制器', message: '检测到不支持的磁盘控制器，迁移可能无法启动。' }] },
];

export const mockTargetInventoryVMs: InventoryVM[] = [
  { id: 'target-erp-app-01', name: 'erp-app-01', namespace: 'vm-workloads', status: 'Running', guestName: 'Red Hat Enterprise Linux 8', cpuCount: 8, memoryMB: 16384, disks: [{ capacity: 520 * GiB }], concerns: [] },
  { id: 'target-finance-core-01', name: 'finance-core-01', namespace: 'vm-workloads', status: 'Running', guestName: 'Rocky Linux 9', cpuCount: 4, memoryMB: 8192, disks: [{ capacity: 120 * GiB }], concerns: [] },
  { id: 'target-archive-app-01', name: 'archive-app-01', namespace: 'archive', status: 'Stopped', guestName: 'Red Hat Enterprise Linux 8', cpuCount: 4, memoryMB: 8192, disks: [{ capacity: 120 * GiB }], concerns: [] },
];

export const mockSourceNetworks: InventoryResource[] = [
  { id: 'network-21', name: 'VM Network', path: '/Production/VM Network' },
  { id: 'network-37', name: 'Backup Network', path: '/Production/Backup Network' },
  { id: 'network-55', name: 'Isolated Network', path: '/Lab/Isolated Network' },
];

export const mockSourceStorages: InventoryResource[] = [
  { id: 'datastore-44', name: 'vsan-prod', path: '/Production/vsan-prod' },
  { id: 'datastore-52', name: 'flash-tier', path: '/Production/flash-tier' },
  { id: 'datastore-79', name: 'archive-tier', path: '/Archive/archive-tier' },
];

export const mockTargetNetworks: InventoryResource[] = [
  { uid: 'nad-prod', namespace: 'vm-workloads', name: 'prod-vlan-120' },
  { uid: 'nad-backup', namespace: 'vm-workloads', name: 'backup-vlan-230' },
  { uid: 'nad-billing', namespace: 'billing', name: 'billing-vlan-310' },
];

export const mockTargetStorages: InventoryResource[] = [
  { uid: 'sc-rbd', name: 'ocs-storagecluster-ceph-rbd', object: { metadata: { name: 'ocs-storagecluster-ceph-rbd', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, provisioner: 'rbd.csi.ceph.com' } },
  { uid: 'sc-cephfs', name: 'ocs-storagecluster-cephfs', object: { metadata: { name: 'ocs-storagecluster-cephfs' }, provisioner: 'cephfs.csi.ceph.com' } },
  { uid: 'sc-local', name: 'local-block', object: { metadata: { name: 'local-block' }, provisioner: 'kubernetes.io/no-provisioner' } },
];

export const mockInventoryNamespaces = [
  { name: 'vm-workloads' },
  { name: 'billing' },
  { name: 'archive' },
];

const vmRunning = {
  id: 'vm-101', name: 'erp-app-01', phase: 'Running', started: ago(42),
  pipeline: [
    { name: 'Initialize', description: '准备迁移', phase: 'Completed', progress: { total: 1, completed: 1 }, completed: ago(39) },
    { name: 'DiskTransfer', description: '复制磁盘', phase: 'Running', progress: { total: 512000, completed: 327680 }, tasks: [
      { name: 'disk-0', description: '系统盘', phase: 'ImportInProgress', progress: { total: 204800, completed: 163840 } },
      { name: 'disk-1', description: '数据盘', phase: 'ImportInProgress', progress: { total: 307200, completed: 163840 } },
    ] },
    { name: 'ImageConversion', description: 'Guest Conversion', phase: 'Pending', progress: { total: 1, completed: 0 } },
    { name: 'CreateVM', description: '创建目标虚拟机', phase: 'Pending', progress: { total: 1, completed: 0 } },
  ],
};

const vmFailed = {
  id: 'vm-102', name: 'erp-db-01', phase: 'Failed', started: ago(58), completed: ago(12),
  error: { phase: 'ImageConversion', reasons: ['virt-v2v inspection failed: no space left on device'] },
  pipeline: [
    { name: 'DiskTransfer', description: '复制磁盘', phase: 'Completed', progress: { total: 1310720, completed: 1310720 }, completed: ago(20) },
    { name: 'ImageConversion', description: 'Guest Conversion', phase: 'Failed', progress: { total: 1, completed: 0 }, error: { phase: 'ImageConversion', reasons: ['目标磁盘空间不足，virt-v2v 无法写入临时文件。'] } },
  ],
};

const vmWarmFinalizing = {
  id: 'vm-103', name: 'billing-win-01', phase: 'Running', started: ago(95),
  pipeline: [
    { name: 'Initialize', description: '准备迁移', phase: 'Completed', progress: { total: 1, completed: 1 }, completed: ago(92) },
    { name: 'DiskTransfer', description: '复制磁盘', phase: 'Completed', progress: { total: 720000, completed: 720000 }, completed: ago(12) },
    { name: 'Cutover', description: 'Finalize disk transfer.', phase: 'Running', started: ago(4), progress: { total: 200000, completed: 80000 }, tasks: [
      { name: 'disk-0', description: '系统盘', phase: 'ImportInProgress', progress: { total: 120000, completed: 60000 } },
      { name: 'disk-1', description: '数据盘', phase: 'ImportInProgress', progress: { total: 80000, completed: 20000 } },
    ] },
    { name: 'ImageConversion', description: 'Guest Conversion', phase: 'Pending', progress: { total: 1, completed: 0 } },
  ],
};

const vmCompletedWithStaleImporter = {
  id: 'vm-89', name: 'archive-app-01', phase: 'Completed', started: ago(8500), completed: ago(8400),
  pipeline: [
    { name: 'DiskTransfer', description: '复制磁盘', phase: 'Running', progress: { total: 128849018880, completed: 126272038502 }, tasks: [
      { name: 'disk-0', description: '系统盘', phase: 'ImportInProgress', progress: { total: 128849018880, completed: 126272038502 } },
    ] },
    { name: 'CreateVM', description: '创建目标虚拟机', phase: 'Completed', progress: { total: 1, completed: 1 }, completed: ago(8400) },
  ],
};

export const mockPlans: Plan[] = [
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
    metadata: { name: 'erp-wave-01', namespace: mockConfig.namespace, uid: 'plan-erp', creationTimestamp: ago(120), generation: 1 },
    spec: {
      description: 'ERP 第一批生产虚拟机', targetNamespace: 'vm-workloads', type: 'cold',
      provider: { source: { name: 'production-vcenter' }, destination: { name: 'host' } },
      map: { network: { name: 'production-networks' }, storage: { name: 'ceph-block-default' } },
      vms: [{ id: 'vm-101' }, { id: 'vm-102' }], skipGuestConversion: false, runPreflightInspection: false,
      targetPowerState: 'auto', preserveStaticIPs: true,
    },
    status: {
      observedGeneration: 1, conditions: [{ type: 'Executing', status: 'True', message: 'Migration is executing' }],
      migration: { started: ago(58), vms: [vmRunning, vmFailed] },
    },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
    metadata: { name: 'billing-wave-02', namespace: mockConfig.namespace, uid: 'plan-billing', creationTimestamp: ago(410), generation: 2 },
    spec: {
      description: '账务 Windows 工作负载', targetNamespace: 'billing', type: 'warm',
      provider: { source: { name: 'production-vcenter' }, destination: { name: 'host' } },
      map: { network: { name: 'production-networks' }, storage: { name: 'ceph-block-default' } },
      vms: [{ id: 'vm-103' }], skipGuestConversion: false, runPreflightInspection: true,
      targetPowerState: 'on', preserveStaticIPs: true,
    },
    status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True', message: 'Plan is ready' }], migration: { vms: [] } },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
    metadata: { name: 'warm-sync-01', namespace: mockConfig.namespace, uid: 'plan-warm-sync', creationTimestamp: ago(180), generation: 1 },
    spec: {
      description: '账务系统增量迁移', targetNamespace: 'billing', warm: true,
      provider: { source: { name: 'production-vcenter' }, destination: { name: 'host' } },
      map: { network: { name: 'production-networks' }, storage: { name: 'ceph-block-default' } },
      vms: [{ id: 'vm-103', warm: true }], skipGuestConversion: false, runPreflightInspection: true,
      targetPowerState: 'on', preserveStaticIPs: true,
    },
    status: {
      observedGeneration: 1,
      conditions: [{ type: 'Executing', status: 'True', message: 'Migration is executing' }],
      migration: {
        started: ago(95), vms: [vmWarmFinalizing],
        history: [{ migration: { name: 'warm-sync-01-migration-2', uid: 'migration-warm-2' }, started: ago(95) }],
      },
    },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
    metadata: { name: 'validation-pending', namespace: mockConfig.namespace, uid: 'plan-pending', creationTimestamp: ago(30), generation: 3 },
    spec: {
      description: '等待控制器完成检查', targetNamespace: 'vm-workloads',
      provider: { source: { name: 'production-vcenter' }, destination: { name: 'host' } },
      map: { network: { name: 'production-networks' }, storage: { name: 'ceph-block-default' } },
      vms: [{ id: 'vm-22', warm: false, xfsCompatibility: false, hooks: [] }],
      skipGuestConversion: false, runPreflightInspection: true,
    },
    status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True', message: 'Previous generation was ready' }], migration: { vms: [] } },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Plan',
    metadata: { name: 'archive-wave-2026q2', namespace: mockConfig.namespace, uid: 'plan-archive', creationTimestamp: ago(9000), generation: 1 },
    spec: {
      description: '已完成的归档批次', targetNamespace: 'archive', type: 'cold',
      provider: { source: { name: 'production-vcenter' }, destination: { name: 'host' } },
      map: { network: { name: 'production-networks' }, storage: { name: 'ceph-block-default' } },
      vms: [{ id: 'vm-89' }, { id: 'vm-90' }, { id: 'vm-91' }], skipGuestConversion: false,
      runPreflightInspection: true, targetPowerState: 'off', preserveStaticIPs: true,
    },
    status: { observedGeneration: 1, conditions: [{ type: 'Succeeded', status: 'True' }], migration: { started: ago(8500), completed: ago(8400), vms: [vmCompletedWithStaleImporter] } },
  },
];

export const mockMigrations: Migration[] = [
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Migration',
    metadata: { name: 'erp-wave-01-migration-1', namespace: mockConfig.namespace, uid: 'migration-erp-1', creationTimestamp: ago(58) },
    spec: { plan: { name: 'erp-wave-01', namespace: mockConfig.namespace } },
    status: { conditions: [{ type: 'Executing', status: 'True' }] },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Migration',
    metadata: { name: 'warm-sync-01-migration-1', namespace: mockConfig.namespace, uid: 'migration-warm-1', creationTimestamp: ago(150) },
    spec: { plan: { name: 'warm-sync-01', namespace: mockConfig.namespace } },
    status: { conditions: [{ type: 'Failed', status: 'True' }] },
  },
  {
    apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Migration',
    metadata: { name: 'warm-sync-01-migration-2', namespace: mockConfig.namespace, uid: 'migration-warm-2', creationTimestamp: ago(95) },
    spec: { plan: { name: 'warm-sync-01', namespace: mockConfig.namespace } },
    status: { conditions: [{ type: 'Executing', status: 'True' }] },
  },
];

export const mockController: ForkliftController = {
  apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'ForkliftController',
  metadata: { name: 'forklift-controller', namespace: mockConfig.namespace, generation: 4 },
  spec: { feature_validation: 'true', feature_ui_plugin: 'true', feature_copy_offload: 'false' },
};

export const mockStore = {
  providers: mockProviders,
  networkmaps: mockNetworkMaps,
  storagemaps: mockStorageMaps,
  plans: mockPlans,
  migrations: mockMigrations,
  forkliftcontrollers: [mockController],
};

export function mockList<T>(resource: keyof typeof mockStore): KubeList<T> {
  return { items: mockStore[resource] as T[] };
}
