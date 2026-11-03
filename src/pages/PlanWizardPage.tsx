import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, HardDrive,
  Library, LoaderCircle, Network, Play, Radio, RefreshCw, Save, Search, Settings2, Snowflake,
} from 'lucide-react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useControllers, useCreateResource, useInventoryNamespaces, useInventoryNetworks, useInventoryStorages, useInventoryVMs,
  useNetworkMaps, usePatchResource, usePlans, useProviders, useStorageMaps,
} from '../api/hooks';
import { appendPlanAction, deleteResource, getRuntimeConfig, patchResource, queuePlanStart } from '../api/client';
import { buildMigration, buildNetworkMap, buildPlan, buildStorageMap } from '../domain/builders';
import { inventoryResourceKey, inventoryVMNamespace, isVMwareToolsConcern, vmResourceRefs, vmsUsingResource } from '../domain/inventory';
import { getPlanMigrationType, isPlanEditable } from '../domain/status';
import type { InventoryConcern, InventoryResource, InventoryVM, KubeList, MappingRef, MigrationType, NetworkMap, Plan, ProviderType, StorageMap } from '../domain/types';
import { isEISTargetProvider, isSourceProvider } from '../domain/providers';
import { Alert, Button, Field, Modal, PageState, Pagination, Select, StatusBadge, Toggle } from '../components/ui';

const steps = ['基本信息', '选择虚拟机', '迁移评估', '网络与存储', '迁移选项', '检查并创建'];
const stepHints = ['环境与迁移方式', '虚拟机范围', '按模式检查风险', '目标资源配置', '系统适配与启动策略', '确认提交'];
const planNamePattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

function kubernetesName(value: string) {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  return normalized || `migration-${Date.now().toString(36)}`;
}

function taskMappingName(taskName: string, kind: 'network' | 'storage') {
  const suffix = `-${kind}`;
  const base = kubernetesName(taskName || 'migration').slice(0, 63 - suffix.length).replace(/-+$/g, '');
  return `${base}${suffix}`;
}

type SelectableMigrationType = Exclude<MigrationType, 'conversion'>;
type MappingMode = 'direct' | 'existing';
type NetworkIPMode = NonNullable<NetworkMap['spec']['map'][number]['networkIPMode']>;
type VolumeMode = NonNullable<StorageMap['spec']['map'][number]['destination']['volumeMode']>;
type AccessMode = NonNullable<StorageMap['spec']['map'][number]['destination']['accessMode']>;

interface AutomaticSource {
  key: string;
  label: string;
  detail: string;
  ref: MappingRef;
  usedBy: InventoryVM[];
}

interface NetworkChoice {
  target: string;
  networkIPMode: NetworkIPMode;
  customName?: string;
  customNamespace?: string;
}

interface StorageChoice {
  storageClass: string;
  volumeMode: VolumeMode;
  accessMode: AccessMode;
}

const podNetworkValue = '__pod__';
const ignoredNetworkValue = '__ignored__';
const customNetworkValue = '__custom__';

const migrationSupport: Record<SelectableMigrationType, string[]> = {
  cold: ['vsphere', 'ovirt', 'openstack', 'openshift', 'ova', 'ec2', 'hyperv', 'nutanix', 'azure'],
  warm: ['vsphere', 'ovirt'],
  live: ['openshift'],
};

const migrationModes: Record<SelectableMigrationType, {
  title: string;
  subtitle: string;
  description: string;
  benefits: string[];
  icon: typeof Snowflake;
}> = {
  cold: {
    title: '冷迁移', subtitle: '停机后完整复制', icon: Snowflake,
    description: '关闭源虚拟机后复制全部数据，流程稳定，适合允许较长停机窗口的业务。',
    benefits: ['一次性完整复制', '适用于多数源平台'],
  },
  warm: {
    title: '温迁移', subtitle: '先预复制，再切换', icon: RefreshCw,
    description: '源虚拟机运行时先同步大部分磁盘，最终切换时只复制增量数据。',
    benefits: ['缩短业务停机时间', '预热完成后再执行切换'],
  },
  live: {
    title: '实时迁移', subtitle: '兼容集群间迁移', icon: Radio,
    description: '用于支持实时迁移的兼容源集群，尽量保持虚拟机持续运行。',
    benefits: ['适用于兼容的源集群', '降低业务中断时间'],
  },
};

function sourceLabel(source: MappingRef) {
  return source.name || source.id || source.type || '/';
}

function sourceIdentifier(source: MappingRef) {
  if (source.namespace && source.name) return `${source.namespace} / ${source.name}`;
  return source.id || source.name || source.type || '/';
}

function sourceKey(source: MappingRef) {
  if (source.namespace && source.name) return `${source.namespace}/${source.name}`;
  return source.id || source.name || source.type || '/';
}

function resourceSourceRef(resource: InventoryResource, providerType: ProviderType): MappingRef {
  if (providerType === 'openshift') {
    if (resource.type === 'pod') return { type: 'pod' };
    return { name: resource.name, ...(resource.namespace ? { namespace: resource.namespace } : {}) };
  }
  return { id: resource.id || resource.uid || resource.name };
}

function fallbackSourceRef(value: string, providerType?: ProviderType): MappingRef {
  if (providerType !== 'openshift') return { id: value };
  if (value === 'pod') return { type: 'pod' };
  const separator = value.indexOf('/');
  return separator > 0
    ? { namespace: value.slice(0, separator), name: value.slice(separator + 1) }
    : { name: value };
}

function automaticSources(
  resources: InventoryResource[],
  vms: InventoryVM[],
  kind: 'network' | 'storage',
  providerType?: ProviderType,
): AutomaticSource[] {
  const refs = Array.from(new Set(vms.flatMap((vm) => Array.from(vmResourceRefs(vm, kind))))).sort();
  if (providerType) {
    const matchedResources = resources.map((resource) => {
      const usedBy = vmsUsingResource(vms, resource, kind, providerType);
      const ref = resourceSourceRef(resource, providerType);
      const identifier = resource.id || resource.uid || sourceKey(ref);
      return { resource, item: {
        key: sourceKey(ref),
        label: resource.name || identifier,
        detail: identifier === resource.name ? sourceKey(ref) : identifier,
        ref,
        usedBy,
      } };
    }).filter(({ item }) => item.usedBy.length > 0);
    if (matchedResources.length > 0) {
      const coveredRefs = new Set(matchedResources.flatMap(({ resource, item }) => [
        resource.id, resource.uid, resource.name,
        resource.namespace && resource.name ? `${resource.namespace}/${resource.name}` : undefined,
        resource.type, item.key,
      ].filter(Boolean).map((value) => String(value).toLowerCase())));
      const fallbacks = refs.filter((value) => !coveredRefs.has(value.toLowerCase())).map((value) => {
        const ref = fallbackSourceRef(value, providerType);
        return { key: sourceKey(ref), label: sourceLabel(ref), detail: value, ref, usedBy: vmsUsingMappingSource(vms, ref, kind) };
      });
      return [...matchedResources.map(({ item }) => item), ...fallbacks];
    }
  }
  return refs.map((value) => {
    const ref = fallbackSourceRef(value, providerType);
    return { key: sourceKey(ref), label: sourceLabel(ref), detail: value, ref, usedBy: vmsUsingMappingSource(vms, ref, kind) };
  });
}

function vmsUsingMappingSource(vms: InventoryVM[], source: MappingRef, kind: 'network' | 'storage') {
  const aliases = [source.id, source.name, source.type, source.namespace && source.name ? `${source.namespace}/${source.name}` : undefined]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return vms.filter((vm) => {
    const refs = vmResourceRefs(vm, kind);
    return aliases.some((alias) => refs.has(alias));
  });
}

function vmUsageText(vms: InventoryVM[]) {
  return vms.length ? `关联虚拟机：${vms.map((vm) => vm.name).join('、')}` : '本批次虚拟机未使用此资源';
}

function networkTarget(destination: NetworkMap['spec']['map'][number]['destination']) {
  if (destination.type === 'multus') {
    return { title: '附加业务网络', detail: `${destination.namespace || '/'} / ${destination.name || '/'}` };
  }
  if (destination.type === 'ignored') return { title: '不连接目标网络', detail: '迁移后不连接此网卡' };
  return { title: '默认集群网络', detail: '由目标集群自动提供' };
}

function networkIPModeLabel(mode?: NetworkMap['spec']['map'][number]['networkIPMode']) {
  if (mode === 'dhcp') return '自动获取 IP';
  if (mode === 'none') return '不配置 IP';
  if (mode === 'preserve') return '保留静态 IP';
  return '无需配置';
}

function mappingRefAliases(ref: MappingRef) {
  return [ref.id, ref.name, ref.type, ref.namespace && ref.name ? `${ref.namespace}/${ref.name}` : undefined]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function uncoveredSources(sources: AutomaticSource[], mapping?: NetworkMap | StorageMap) {
  if (!mapping) return sources;
  return sources.filter((source) => {
    const aliases = new Set(mappingRefAliases(source.ref));
    return !mapping.spec.map.some((item) => mappingRefAliases(item.source).some((alias) => aliases.has(alias)));
  });
}

function mappingIsReady(mapping?: NetworkMap | StorageMap) {
  if (!mapping) return false;
  const currentGeneration = mapping.metadata.generation === undefined
    || mapping.status?.observedGeneration === mapping.metadata.generation;
  return Boolean(currentGeneration && mapping.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
}

function NetworkMapPreview({ mapping, vms }: { mapping: NetworkMap; vms: InventoryVM[] }) {
  return <div className="wizard-map-preview">
    {mapping.spec.map.map((item, index) => {
      const usedBy = vmsUsingMappingSource(vms, item.source, 'network');
      const target = networkTarget(item.destination);
      return <div className="wizard-map-row" key={`${sourceIdentifier(item.source)}-${index}`}>
        <div className="wizard-map-endpoint">
          <span className="wizard-map-icon"><Network size={16} /></span>
          <div><strong>{sourceLabel(item.source)}</strong><small>源网络标识：{sourceIdentifier(item.source)}</small><em>{vmUsageText(usedBy)}</em></div>
        </div>
        <ArrowRight className="wizard-map-arrow" size={18} />
        <div className="wizard-map-endpoint target">
          <span className="wizard-map-icon"><Network size={16} /></span>
          <div><strong>{target.title}</strong><small>{target.detail}</small></div>
        </div>
        <span className="wizard-map-policy">{networkIPModeLabel(item.networkIPMode)}</span>
      </div>;
    })}
  </div>;
}

function StorageMapPreview({ mapping, vms }: { mapping: StorageMap; vms: InventoryVM[] }) {
  return <div className="wizard-map-preview">
    {mapping.spec.map.map((item, index) => {
      const usedBy = vmsUsingMappingSource(vms, item.source, 'storage');
      return <div className="wizard-map-row storage" key={`${sourceIdentifier(item.source)}-${index}`}>
        <div className="wizard-map-endpoint">
          <span className="wizard-map-icon storage"><HardDrive size={16} /></span>
          <div><strong>{sourceLabel(item.source)}</strong><small>源存储标识：{sourceIdentifier(item.source)}</small><em>{vmUsageText(usedBy)}</em></div>
        </div>
        <ArrowRight className="wizard-map-arrow" size={18} />
        <div className="wizard-map-endpoint target">
          <span className="wizard-map-icon storage"><HardDrive size={16} /></span>
          <div><strong>{item.destination.storageClass || '/'}</strong><small>目标存储名称</small></div>
        </div>
        <div className="wizard-storage-modes">
          <span>卷模式 <strong>{item.destination.volumeMode || '/'}</strong></span>
          <span>访问模式 <strong>{item.destination.accessMode || '/'}</strong></span>
        </div>
      </div>;
    })}
  </div>;
}

function BlockingStatus({ vm, concerns }: { vm: InventoryVM; concerns?: InventoryConcern[] }) {
  const blockers = concerns || (vm.concerns || []).filter((concern) => concern.category === 'Critical');
  if (!blockers.length) return null;
  return <span className="risk-tooltip" tabIndex={0} aria-label={`${vm.name} 有 ${blockers.length} 个迁移阻塞项`}>
    <StatusBadge tone="danger">阻塞</StatusBadge>
    <span className="risk-tooltip-content" role="tooltip">
      <strong><AlertTriangle size={14} />迁移阻塞原因</strong>
      {blockers.map((blocker, index) => <span key={`${blocker.id || blocker.label}-${index}`}><b>{blocker.label || '兼容性检查未通过'}</b>{blocker.message || blocker.assessment || '请处理后再选择此虚拟机。'}</span>)}
    </span>
  </span>;
}

export function PlanWizardPage() {
  const { name: editingName } = useParams();
  const plansQuery = usePlans();
  const plans = plansQuery.data?.items || [];
  if (!editingName) return <PlanWizardForm plans={plans} />;
  if (plansQuery.isLoading) return <PageState loading />;
  if (plansQuery.error) return <PageState error={plansQuery.error} />;
  const plan = plans.find((item) => item.metadata.name === editingName);
  if (!plan) return <Alert tone="danger" title="任务不存在">无法找到迁移任务 {editingName}。<div style={{ marginTop: 8 }}><Link to="/plans">返回列表</Link></div></Alert>;
  if (!isPlanEditable(plan)) return <Alert tone="warning" title="该任务不能修改">已经启动、正在执行或已归档的迁移任务不能直接修改。<div style={{ marginTop: 8 }}><Link to={`/plans/${plan.metadata.name}`}>返回任务详情</Link></div></Alert>;
  return <PlanWizardForm plan={plan} plans={plans} />;
}

function PlanWizardForm({ plan: editingPlan, plans }: { plan?: Plan; plans: Plan[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const wizardNavRef = useRef<HTMLElement>(null);
  const previousStepRef = useRef(0);
  const [searchParams] = useSearchParams();
  const requestedProvider = editingPlan ? '' : searchParams.get('provider') || '';
  const requestedVMs = editingPlan ? [] : searchParams.getAll('vm');
  const providersQuery = useProviders();
  const networkMapsQuery = useNetworkMaps();
  const storageMapsQuery = useStorageMaps();
  const controllersQuery = useControllers();
  const createPlan = useCreateResource<Plan>('plans');
  const patchPlan = usePatchResource<Plan>('plans');
  const createNetworkMap = useCreateResource<NetworkMap>('networkmaps');
  const createStorageMap = useCreateResource<StorageMap>('storagemaps');
  const patchNetworkMap = usePatchResource<NetworkMap>('networkmaps');
  const patchStorageMap = usePatchResource<StorageMap>('storagemaps');
  const existingType = editingPlan ? getPlanMigrationType(editingPlan) : 'cold';
  const [step, setStep] = useState(0);
  const [name, setName] = useState(editingPlan?.metadata.name || '');
  const [description, setDescription] = useState(editingPlan?.spec.description || '');
  const [sourceName, setSourceName] = useState(editingPlan?.spec.provider.source.name || requestedProvider);
  const [destinationName, setDestinationName] = useState(editingPlan?.spec.provider.destination.name || 'host');
  const [targetNamespace, setTargetNamespace] = useState(editingPlan?.spec.targetNamespace || '');
  const [type, setType] = useState<SelectableMigrationType>(existingType === 'conversion' ? 'cold' : existingType);
  const [selectedVMs, setSelectedVMs] = useState<string[]>(() => editingPlan?.spec.vms.map((vm) => vm.id) || requestedVMs);
  const [vmSearch, setVmSearch] = useState('');
  const [vmPowerFilter, setVmPowerFilter] = useState<'all' | 'on' | 'off'>('all');
  const [vmRiskFilter, setVmRiskFilter] = useState<'all' | 'warning' | 'critical'>('all');
  const [vmPage, setVmPage] = useState(1);
  const [showAllConcerns, setShowAllConcerns] = useState(false);
  const [networkMapName, setNetworkMapName] = useState(editingPlan?.spec.map.network.name || '');
  const [storageMapName, setStorageMapName] = useState(editingPlan?.spec.map.storage.name || '');
  const [networkMapSearch, setNetworkMapSearch] = useState('');
  const [storageMapSearch, setStorageMapSearch] = useState('');
  const [expandedMapping, setExpandedMapping] = useState<'network' | 'storage' | null>(null);
  const [networkMappingMode, setNetworkMappingMode] = useState<MappingMode>(editingPlan ? 'existing' : 'direct');
  const [storageMappingMode, setStorageMappingMode] = useState<MappingMode>(editingPlan ? 'existing' : 'direct');
  const [networkChoices, setNetworkChoices] = useState<Record<string, NetworkChoice>>({});
  const [storageChoices, setStorageChoices] = useState<Record<string, StorageChoice>>({});
  const [skipVMwareToolsVMs, setSkipVMwareToolsVMs] = useState<string[]>(() => editingPlan?.spec.vms.filter((vm) => vm.skipVMwareTools).map((vm) => vm.id) || []);
  const [skipGuestConversion, setSkipGuestConversion] = useState(editingPlan?.spec.skipGuestConversion ?? false);
  const [runPreflightInspection, setRunPreflightInspection] = useState(editingPlan?.spec.runPreflightInspection ?? true);
  const [targetPowerState, setTargetPowerState] = useState<'on' | 'off' | 'auto'>(editingPlan?.spec.targetPowerState || 'auto');
  const [preserveStaticIPs, setPreserveStaticIPs] = useState(editingPlan?.spec.preserveStaticIPs ?? true);
  const [submissionMode, setSubmissionMode] = useState<'save' | 'start' | null>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [committedNetworkMap, setCommittedNetworkMap] = useState<NetworkMap>();
  const [committedStorageMap, setCommittedStorageMap] = useState<StorageMap>();
  const allowNavigationRef = useRef(false);

  useEffect(() => {
    const nav = wizardNavRef.current;
    const activeStep = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !activeStep) return;
    if (previousStepRef.current !== step) nav.scrollIntoView({ block: 'start', behavior: 'auto' });
    nav.scrollTo({ left: activeStep.offsetLeft + activeStep.offsetWidth / 2 - nav.clientWidth / 2, behavior: 'auto' });
    previousStepRef.current = step;
  }, [step]);

  const providers = providersQuery.data?.items || [];
  const sourceProviders = providers.filter(isSourceProvider);
  const targetProviders = providers.filter(isEISTargetProvider);
  const effectiveSourceName = sourceName;
  const effectiveDestinationName = targetProviders.some((provider) => provider.metadata.name === destinationName)
    ? destinationName : targetProviders[0]?.metadata.name || '';
  const source = providers.find((provider) => provider.metadata.name === effectiveSourceName);
  const destination = providers.find((provider) => provider.metadata.name === effectiveDestinationName);
  const runtimeConfig = getRuntimeConfig();
  const vmQuery = useInventoryVMs(source);
  const targetVMQuery = useInventoryVMs(destination);
  const namespaceQuery = useInventoryNamespaces(destination);
  const sourceNetworksQuery = useInventoryNetworks(source, 'source');
  const sourceStoragesQuery = useInventoryStorages(source, 'source');
  const targetNetworksQuery = useInventoryNetworks(destination, 'target');
  const targetStoragesQuery = useInventoryStorages(destination, 'target');
  const targetNamespaces = (namespaceQuery.data || []).slice().sort((left, right) => left.name.localeCompare(right.name));
  if (targetNamespace && !targetNamespaces.some((namespace) => namespace.name === targetNamespace)) targetNamespaces.unshift({ name: targetNamespace });
  const selectedInventoryVMs = (vmQuery.data || []).filter((vm) => selectedVMs.includes(vm.id));
  const skipVMwareToolsSet = new Set(skipVMwareToolsVMs);
  const effectiveCriticalConcerns = (vm: InventoryVM) => (vm.concerns || []).filter((concern) => {
    const warmOnly = /CBT|changed block|快照|snapshot/i.test(`${concern.id || ''} ${concern.label || ''} ${concern.message || ''} ${concern.assessment || ''}`);
    return concern.category === 'Critical'
      && (!warmOnly || type === 'warm')
      && !(skipVMwareToolsSet.has(vm.id) && isVMwareToolsConcern(concern));
  });
  const selectedCriticalVMs = selectedInventoryVMs.filter((vm) => effectiveCriticalConcerns(vm).length > 0);
  const vmwareToolsExceptionCandidates = source?.spec.type === 'vsphere'
    ? selectedInventoryVMs.filter((vm) => !skipVMwareToolsSet.has(vm.id) && (vm.concerns || []).some((concern) => concern.category === 'Critical' && isVMwareToolsConcern(concern)))
    : [];
  const skippedVMwareToolsInventoryVMs = source?.spec.type === 'vsphere'
    ? selectedInventoryVMs.filter((vm) => skipVMwareToolsSet.has(vm.id))
    : [];
  const networkSources = automaticSources(sourceNetworksQuery.data || [], selectedInventoryVMs, 'network', source?.spec.type);
  const storageSources = automaticSources(sourceStoragesQuery.data || [], selectedInventoryVMs, 'storage', source?.spec.type);
  const targetNetworks = targetNetworksQuery.data || [];
  const targetStorages = targetStoragesQuery.data || [];
  const defaultStorageClass = targetStorages.find((resource) => resource.object?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true')?.name
    || targetStorages.find((resource) => resource.name === runtimeConfig.defaultStorageClass)?.name
    || runtimeConfig.defaultStorageClass
    || targetStorages[0]?.name
    || '';
  const targetStorageClasses = Array.from(new Set([defaultStorageClass, ...targetStorages.map((resource) => resource.name)].filter(Boolean)));
  const networkMaps = (networkMapsQuery.data?.items || []).filter((mapping) =>
    (!effectiveSourceName || mapping.spec.provider.source.name === effectiveSourceName)
    && (!effectiveDestinationName || mapping.spec.provider.destination.name === effectiveDestinationName)
    && (!mapping.metadata.labels?.['eis-dmt.io/managed-for-task']
      || editingPlan?.spec.map.network.name === mapping.metadata.name));
  const storageMaps = (storageMapsQuery.data?.items || []).filter((mapping) =>
    (!effectiveSourceName || mapping.spec.provider.source.name === effectiveSourceName)
    && (!effectiveDestinationName || mapping.spec.provider.destination.name === effectiveDestinationName)
    && (!mapping.metadata.labels?.['eis-dmt.io/managed-for-task']
      || editingPlan?.spec.map.storage.name === mapping.metadata.name));
  const effectiveExistingNetworkMapName = networkMaps.some((mapping) => mapping.metadata.name === networkMapName)
    ? networkMapName : networkMaps[0]?.metadata.name || '';
  const effectiveExistingStorageMapName = storageMaps.some((mapping) => mapping.metadata.name === storageMapName)
    ? storageMapName : storageMaps[0]?.metadata.name || '';
  const existingNetworkMap = networkMaps.find((mapping) => mapping.metadata.name === effectiveExistingNetworkMapName);
  const existingStorageMap = storageMaps.find((mapping) => mapping.metadata.name === effectiveExistingStorageMapName);
  const filteredNetworkMaps = networkMaps.filter((mapping) =>
    `${mapping.metadata.name} ${mapping.spec.map.flatMap((item) => [sourceIdentifier(item.source), networkTarget(item.destination).title, networkTarget(item.destination).detail]).join(' ')}`
      .toLowerCase().includes(networkMapSearch.trim().toLowerCase()));
  const filteredStorageMaps = storageMaps.filter((mapping) =>
    `${mapping.metadata.name} ${mapping.spec.map.flatMap((item) => [sourceIdentifier(item.source), item.destination.storageClass, item.destination.volumeMode, item.destination.accessMode]).join(' ')}`
      .toLowerCase().includes(storageMapSearch.trim().toLowerCase()));
  const directNetworkName = taskMappingName(name, 'network');
  const directStorageName = taskMappingName(name, 'storage');
  const directNetworkMap: NetworkMap | undefined = source && destination && networkSources.length > 0 ? buildNetworkMap({
    name: directNetworkName,
    namespace: runtimeConfig.namespace,
    source,
    destination,
    pairs: networkSources.map((item) => {
        const choice = networkChoices[item.key] || { target: podNetworkValue, networkIPMode: preserveStaticIPs ? 'preserve' : 'dhcp' };
        const targetResource = targetNetworks.find((resource) => inventoryResourceKey(resource, destination.spec.type) === choice.target);
        const destinationNetwork = choice.target === ignoredNetworkValue
          ? { type: 'ignored' as const }
          : choice.target === customNetworkValue
            ? { type: 'multus' as const, name: choice.customName?.trim(), namespace: choice.customNamespace?.trim() || targetNamespace }
            : targetResource
              ? { type: 'multus' as const, name: targetResource.name, namespace: targetResource.namespace || targetNamespace || runtimeConfig.namespace }
              : { type: 'pod' as const };
        return {
          source: item.ref,
          destination: destinationNetwork,
          networkIPMode: choice.networkIPMode,
        };
      }),
  }) : undefined;
  if (directNetworkMap) directNetworkMap.metadata.labels = { 'eis-dmt.io/managed-for-task': name };
  const directStorageMap: StorageMap | undefined = source && destination && storageSources.length > 0 && defaultStorageClass ? buildStorageMap({
    name: directStorageName,
    namespace: runtimeConfig.namespace,
    source,
    destination,
    pairs: storageSources.map((item) => {
      const choice = storageChoices[item.key] || {
        storageClass: defaultStorageClass,
        volumeMode: runtimeConfig.defaultVolumeMode,
        accessMode: runtimeConfig.defaultAccessMode,
      };
      return {
        sourceId: item.ref.id || '', sourceName: item.ref.name, sourceNamespace: item.ref.namespace, sourceType: item.ref.type,
        storageClass: choice.storageClass, volumeMode: choice.volumeMode, accessMode: choice.accessMode,
      };
    }),
  }) : undefined;
  if (directStorageMap) directStorageMap.metadata.labels = { 'eis-dmt.io/managed-for-task': name };
  const networkMap = networkMappingMode === 'direct' ? directNetworkMap : existingNetworkMap;
  const storageMap = storageMappingMode === 'direct' ? directStorageMap : existingStorageMap;
  const missingNetworkSources = networkMappingMode === 'existing' ? uncoveredSources(networkSources, existingNetworkMap) : [];
  const missingStorageSources = storageMappingMode === 'existing' ? uncoveredSources(storageSources, existingStorageMap) : [];
  const invalidExistingNetworkRules = networkMappingMode === 'existing'
    ? existingNetworkMap?.spec.map.filter((item) => item.destination.type !== 'multus' && item.networkIPMode !== undefined) || []
    : [];
  const incompleteCustomNetworks = networkMappingMode === 'direct'
    ? networkSources.filter((item) => networkChoices[item.key]?.target === customNetworkValue
      && !networkChoices[item.key]?.customName?.trim())
    : [];
  const existingNetworkReady = networkMappingMode !== 'existing' || mappingIsReady(existingNetworkMap);
  const existingStorageReady = storageMappingMode !== 'existing' || mappingIsReady(existingStorageMap);
  const effectiveNetworkMapName = networkMap?.metadata.name || '';
  const effectiveStorageMapName = storageMap?.metadata.name || '';
  const validationEnabled = controllersQuery.data?.items[0]?.spec.feature_validation !== 'false';

  const targetNamespaceVMs = (targetVMQuery.data || []).filter((vm) => inventoryVMNamespace(vm) === targetNamespace);
  const targetNames = new Set(targetNamespaceVMs.map((vm) => vm.name.toLowerCase()));
  const duplicateTargetVMs = selectedInventoryVMs.filter((vm) => targetNames.has(vm.name.toLowerCase()));
  const concerns = selectedInventoryVMs.flatMap((vm) => (vm.concerns || []).map((concern) => ({
    ...concern,
    vm: vm.name,
    vmId: vm.id,
    waived: concern.category === 'Critical' && skipVMwareToolsSet.has(vm.id) && isVMwareToolsConcern(concern),
    blocks: concern.category === 'Critical'
      && (type === 'warm' || !/CBT|changed block|快照|snapshot/i.test(`${concern.id || ''} ${concern.label || ''} ${concern.message || ''} ${concern.assessment || ''}`))
      && !(skipVMwareToolsSet.has(vm.id) && isVMwareToolsConcern(concern)),
  })));
  const criticalCount = concerns.filter((concern) => concern.blocks).length;
  const selectedCriticalIDs = new Set(selectedCriticalVMs.map((vm) => vm.id));
  const migratableSelectedCount = selectedVMs.length - selectedCriticalVMs.length;
  const filteredVMs = (vmQuery.data || []).filter((vm) => {
    const matchesSearch = `${vm.name} ${vm.path || ''} ${vm.guestName || ''}`.toLowerCase().includes(vmSearch.toLowerCase());
    const poweredOn = vm.powerState === 'poweredOn';
    const matchesPower = vmPowerFilter === 'all' || (vmPowerFilter === 'on' ? poweredOn : !poweredOn);
    const critical = effectiveCriticalConcerns(vm).length > 0;
    const warning = (vm.concerns || []).length > 0 && !critical;
    const matchesRisk = vmRiskFilter === 'all' || (vmRiskFilter === 'critical' ? critical : warning);
    return matchesSearch && matchesPower && matchesRisk;
  });
  const vmPageSize = 25;
  const vmPageCount = Math.max(1, Math.ceil(filteredVMs.length / vmPageSize));
  const currentVMPage = Math.min(vmPage, vmPageCount);
  const pagedVMs = filteredVMs.slice((currentVMPage - 1) * vmPageSize, currentVMPage * vmPageSize);
  const visibleVMIds = pagedVMs.map((vm) => vm.id);
  const allVisibleSelected = visibleVMIds.length > 0 && visibleVMIds.every((id) => selectedVMs.includes(id));
  const planNameExists = !editingPlan && plans.some((plan) => plan.metadata.name === name);
  const planNameValid = Boolean(name && name.length <= 63 && planNamePattern.test(name) && !planNameExists);

  const valid = [
    Boolean(planNameValid && source && destination && targetNamespace && type && !targetVMQuery.isLoading),
    selectedVMs.length > 0 && duplicateTargetVMs.length === 0 && (!validationEnabled || selectedCriticalVMs.length === 0) && !targetVMQuery.isLoading,
    !validationEnabled || criticalCount === 0,
    Boolean(networkMap && storageMap
      && missingNetworkSources.length === 0 && missingStorageSources.length === 0
      && invalidExistingNetworkRules.length === 0 && incompleteCustomNetworks.length === 0
      && existingNetworkReady && existingStorageReady),
    Boolean(type),
    true,
  ];

  const deselectCriticalVMs = () => setSelectedVMs((current) => current.filter((id) => !selectedCriticalIDs.has(id)));
  const enableVMwareToolsCompatibility = (vmIds: string[]) => setSkipVMwareToolsVMs((current) => Array.from(new Set([...current, ...vmIds])));
  const setVMwareToolsCompatibility = (vmId: string, enabled: boolean) => setSkipVMwareToolsVMs((current) =>
    enabled ? Array.from(new Set([...current, vmId])) : current.filter((id) => id !== vmId));

  const draftSnapshot = JSON.stringify({
    name, description, sourceName, destinationName, targetNamespace, type, selectedVMs,
    networkMapName, storageMapName, networkMappingMode, storageMappingMode, networkChoices, storageChoices,
    skipVMwareToolsVMs, skipGuestConversion, runPreflightInspection, targetPowerState, preserveStaticIPs,
  });
  const [initialDraftSnapshot] = useState(() => draftSnapshot);
  const draftDirty = initialDraftSnapshot !== draftSnapshot;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !allowNavigationRef.current
    && draftDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!draftDirty || allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftDirty]);
  const updateNetworkChoice = (key: string, patch: Partial<NetworkChoice>) => setNetworkChoices((current) => ({
    ...current,
    [key]: {
      target: current[key]?.target || podNetworkValue,
      networkIPMode: current[key]?.networkIPMode || (preserveStaticIPs ? 'preserve' : 'dhcp'),
      ...patch,
    },
  }));
  const updateStorageChoice = (key: string, patch: Partial<StorageChoice>) => setStorageChoices((current) => ({
    ...current,
    [key]: {
      storageClass: current[key]?.storageClass || defaultStorageClass,
      volumeMode: current[key]?.volumeMode || runtimeConfig.defaultVolumeMode,
      accessMode: current[key]?.accessMode || runtimeConfig.defaultAccessMode,
      ...patch,
    },
  }));

  const submit = async (startImmediately: boolean) => {
    if (!planNameValid || !source || !destination || !networkMap || !storageMap || !valid.every(Boolean)) return;
    setSubmissionMode(startImmediately ? 'start' : 'save');
    setSubmissionError('');
    const createdResources: Array<{ resource: 'networkmaps' | 'storagemaps'; name: string }> = [];
    const previousSpecs: Array<{ resource: 'networkmaps' | 'storagemaps'; name: string; spec: NetworkMap['spec'] | StorageMap['spec'] }> = [];
    let savedPlan: Plan | undefined;
    try {
      let finalNetworkMap = networkMap;
      let finalStorageMap = storageMap;
      if (networkMappingMode === 'direct') {
        const alreadyCreated = committedNetworkMap?.metadata.name === directNetworkName
          ? committedNetworkMap
          : (networkMapsQuery.data?.items || []).find((mapping) => mapping.metadata.name === directNetworkName);
        if (alreadyCreated && alreadyCreated.metadata.labels?.['eis-dmt.io/managed-for-task'] !== name) {
          throw new Error(`网络配置名称 ${directNetworkName} 已被其他配置使用，请修改任务名称。`);
        }
        if (alreadyCreated) {
          previousSpecs.push({ resource: 'networkmaps', name: alreadyCreated.metadata.name, spec: alreadyCreated.spec });
          finalNetworkMap = await patchNetworkMap.mutateAsync({ name: alreadyCreated.metadata.name, patch: { spec: networkMap.spec, metadata: { labels: networkMap.metadata.labels } } });
        } else {
          finalNetworkMap = await createNetworkMap.mutateAsync(networkMap);
          createdResources.push({ resource: 'networkmaps', name: finalNetworkMap.metadata.name });
        }
        setCommittedNetworkMap(finalNetworkMap);
      }
      if (storageMappingMode === 'direct') {
        const alreadyCreated = committedStorageMap?.metadata.name === directStorageName
          ? committedStorageMap
          : (storageMapsQuery.data?.items || []).find((mapping) => mapping.metadata.name === directStorageName);
        if (alreadyCreated && alreadyCreated.metadata.labels?.['eis-dmt.io/managed-for-task'] !== name) {
          throw new Error(`存储配置名称 ${directStorageName} 已被其他配置使用，请修改任务名称。`);
        }
        if (alreadyCreated) {
          previousSpecs.push({ resource: 'storagemaps', name: alreadyCreated.metadata.name, spec: alreadyCreated.spec });
          finalStorageMap = await patchStorageMap.mutateAsync({ name: alreadyCreated.metadata.name, patch: { spec: storageMap.spec, metadata: { labels: storageMap.metadata.labels } } });
        } else {
          finalStorageMap = await createStorageMap.mutateAsync(storageMap);
          createdResources.push({ resource: 'storagemaps', name: finalStorageMap.metadata.name });
        }
        setCommittedStorageMap(finalStorageMap);
      }
      const nextPlan = buildPlan({
        name, namespace: getRuntimeConfig().namespace, description, targetNamespace, type,
        source, destination, networkMap: finalNetworkMap, storageMap: finalStorageMap, vmIds: selectedVMs, skipGuestConversion,
        skipVMwareToolsVMIds: source.spec.type === 'vsphere' ? skipVMwareToolsVMs.filter((id) => selectedVMs.includes(id)) : [],
        runPreflightInspection, targetPowerState, preserveStaticIPs,
      });
      if (editingPlan) {
        const existingVMs = new Map(editingPlan.spec.vms.map((vm) => [vm.id, vm]));
        const nextVMs = new Map(nextPlan.spec.vms.map((vm) => [vm.id, vm]));
        nextPlan.spec = {
          ...editingPlan.spec,
          ...nextPlan.spec,
          vms: selectedVMs.map((id) => ({ ...(existingVMs.get(id) || { id }), ...(nextVMs.get(id) || { id }) })),
        };
        savedPlan = await patchPlan.mutateAsync({ name: editingPlan.metadata.name, patch: { spec: nextPlan.spec } });
      } else {
        savedPlan = await createPlan.mutateAsync(nextPlan);
      }
      await appendPlanAction(savedPlan.metadata.name, editingPlan ? '修改任务配置' : '创建迁移任务').catch(() => undefined);
      if (startImmediately) {
        const queued = await queuePlanStart(savedPlan.metadata.name, buildMigration(savedPlan));
        await appendPlanAction(savedPlan.metadata.name, '保存并请求立即开始迁移').catch(() => undefined);
        if (queued.plan) {
          queryClient.setQueryData<KubeList<Plan>>(['plans'], (current) => ({
            ...(current || {}),
            items: current?.items.some((item) => item.metadata.name === queued.plan?.metadata.name)
              ? current.items.map((item) => item.metadata.name === queued.plan?.metadata.name ? queued.plan as Plan : item)
              : [...(current?.items || []), queued.plan as Plan],
          }));
        } else {
          await queryClient.invalidateQueries({ queryKey: ['plans'] });
        }
      }
      allowNavigationRef.current = true;
      navigate(`/plans/${savedPlan.metadata.name}`);
    } catch (error) {
      if (!savedPlan) {
        await Promise.all(previousSpecs.map((item) => patchResource(item.resource, item.name, { spec: item.spec }).catch(() => undefined)));
        await Promise.all(createdResources.map((item) => deleteResource(item.resource, item.name).catch(() => undefined)));
      }
      const detail = error instanceof Error ? error.message : String(error);
      setSubmissionError(savedPlan ? `任务已保存，但后续操作失败：${detail}。可进入任务详情手动启动。` : detail);
    } finally {
      setSubmissionMode(null);
    }
  };

  const savePending = createNetworkMap.isPending || createStorageMap.isPending || patchNetworkMap.isPending || patchStorageMap.isPending || createPlan.isPending || patchPlan.isPending || Boolean(submissionMode);
  const saveError = submissionError || createNetworkMap.error || createStorageMap.error || patchNetworkMap.error || patchStorageMap.error || createPlan.error || patchPlan.error;
  const firstStorageTarget = storageMap?.spec.map[0]?.destination;
  const migrationModeSection = <section className="wizard-settings-section migration-mode-section">
    <div className="wizard-settings-heading"><h3>迁移方式</h3><span>先选择方式，后续风险评估会按该方式判断</span></div>
    <div className="migration-mode-grid">{(Object.keys(migrationModes) as SelectableMigrationType[]).map((mode) => {
      const details = migrationModes[mode];
      const Icon = details.icon;
      const supported = !source || migrationSupport[mode].includes(source.spec.type);
      return <button type="button" className={`migration-mode-card ${type === mode ? 'selected' : ''}`} disabled={!supported} aria-pressed={type === mode} key={mode} onClick={() => setType(mode)}>
        <span className="migration-mode-icon"><Icon size={20} /></span><strong>{details.title}</strong><small>{supported ? details.subtitle : '当前源端平台不支持'}</small><p>{details.description}</p><span className="migration-mode-benefits">{details.benefits.map((benefit) => <em key={benefit}><Check size={12} />{benefit}</em>)}</span>
      </button>;
    })}</div>
    {type === 'warm' && <Alert tone="info" title="温迁移执行方式">先在业务运行期间同步基础数据，准备完成后再到任务详情中安排停机切换。</Alert>}
  </section>;

  const stepBody = [
    <div key="general">
      <h2>基本信息</h2><p>先确定迁移来源、目标位置和迁移方式，再选择虚拟机。</p>
      <div className="form-grid">
        <Field label="任务名称" required help="任务标识仅支持小写字母、数字和连字符，最长 63 个字符；创建后不可修改。">
          <div className="name-input-row"><input value={name} disabled={Boolean(editingPlan)} aria-invalid={Boolean(name && !planNameValid)} onChange={(event) => setName(event.target.value)} placeholder="例如 ERP 第一批迁移" />{!editingPlan && name && (!planNamePattern.test(name) || name.length > 63) && <Button type="button" variant="secondary" onClick={() => setName(kubernetesName(name))}>生成合规标识符</Button>}</div>
          {name && (name.length > 63 || !planNamePattern.test(name)) && <small className="field-error">当前名称不符合规范，请使用自动生成，或改为小写字母、数字和连字符。</small>}
          {planNameExists && <small className="field-error">已经存在同名迁移任务，请使用其他名称。</small>}
        </Field>
        <Field label="源端平台" required><Select value={effectiveSourceName} onChange={(event) => { const value = event.target.value; setSourceName(value); setSelectedVMs([]); setSkipVMwareToolsVMs([]); setNetworkMapName(''); setStorageMapName(''); setNetworkChoices({}); setStorageChoices({}); setCommittedNetworkMap(undefined); setCommittedStorageMap(undefined); const nextSource = providers.find((provider) => provider.metadata.name === value); if (nextSource && !migrationSupport[type].includes(nextSource.spec.type)) setType('cold'); }}><option value="">请选择源端平台</option>{sourceProviders.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
        <Field label="EIS 目标集群" required><Select value={effectiveDestinationName} onChange={(event) => { setDestinationName(event.target.value); setTargetNamespace(''); setNetworkMapName(''); setStorageMapName(''); setNetworkChoices({}); setStorageChoices({}); setCommittedNetworkMap(undefined); setCommittedStorageMap(undefined); }}><option value="">请选择目标集群</option>{targetProviders.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
        <Field label="目标资源空间" required><Select value={targetNamespace} onChange={(event) => setTargetNamespace(event.target.value)} disabled={!destination || namespaceQuery.isLoading}><option value="">{namespaceQuery.isLoading ? '正在加载...' : '请选择目标资源空间'}</option>{targetNamespaces.map((namespace) => <option value={namespace.name} key={namespace.name}>{namespace.name}</option>)}</Select>{namespaceQuery.error && <small className="field-error">目标资源空间加载失败：{namespaceQuery.error.message}</small>}</Field>
        <Field label="描述"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明本批次的业务范围和变更窗口" /></Field>
      </div>
      {migrationModeSection}
          {targetNamespace && targetNamespaceVMs.length > 0 && <div style={{ marginTop: 18 }}><Alert tone="warning" title={`目标资源空间已有 ${targetNamespaceVMs.length} 台虚拟机`}>系统会在选择虚拟机时检查名称冲突。若迁移同名虚拟机，请改用其他目标资源空间，避免覆盖或创建失败。</Alert></div>}
      {targetVMQuery.error && <div style={{ marginTop: 18 }}><Alert tone="warning" title="暂时无法检查目标虚拟机">目标资源清单读取失败，创建任务前请确认目标资源空间中没有同名虚拟机。</Alert></div>}
      {requestedVMs.length > 0 && <div style={{ marginTop: 18 }}><Alert tone="info" title="已带入虚拟机">已从资源列表选择 {requestedVMs.length} 台虚拟机。完成基本信息后，可在下一步核对迁移范围。</Alert></div>}
    </div>,
    <div key="vms">
      <h2>选择虚拟机</h2><p>从源集群资源清单中选择本次迁移的虚拟机。“迁移警告”不影响继续，“迁移阻塞”需要先处理或取消选择。</p>
      {duplicateTargetVMs.length > 0 && <Alert tone="danger" title={`发现 ${duplicateTargetVMs.length} 台同名虚拟机`}>目标资源空间 <strong>{targetNamespace}</strong> 已存在：{duplicateTargetVMs.map((vm) => vm.name).join('、')}。请取消选择这些虚拟机，或返回上一步更换目标资源空间。</Alert>}
      {validationEnabled && selectedCriticalVMs.length > 0 && <div className="wizard-inline-alert"><Alert tone="danger" title="当前迁移批次暂不可执行"><div className="alert-action-row"><span>{selectedCriticalVMs.map((vm) => vm.name).join('、')} 存在迁移阻塞。迁移任务以整个批次启动，但其他 {migratableSelectedCount} 台虚拟机本身并未被标记为无法迁移。</span><div className="alert-action-buttons">{vmwareToolsExceptionCandidates.length > 0 && <Button type="button" variant="secondary" onClick={() => enableVMwareToolsCompatibility(vmwareToolsExceptionCandidates.map((vm) => vm.id))}>允许无 VMware Tools 继续迁移（{vmwareToolsExceptionCandidates.length} 台）</Button>}<Button type="button" variant="secondary" onClick={deselectCriticalVMs}>移除阻塞虚拟机（共 {selectedCriticalVMs.length} 台）</Button></div></div></Alert></div>}
      <PageState loading={vmQuery.isLoading} error={vmQuery.error} empty={!source} emptyText="请先选择源环境">
        <div className="vm-picker">
          <div className="vm-picker-header wizard-vm-toolbar">
            <input className="input" value={vmSearch} onChange={(event) => { setVmSearch(event.target.value); setVmPage(1); }} placeholder="搜索虚拟机、路径或操作系统" />
            <Select aria-label="电源状态筛选" value={vmPowerFilter} onChange={(event) => { setVmPowerFilter(event.target.value as typeof vmPowerFilter); setVmPage(1); }}><option value="all">全部电源状态</option><option value="on">运行中</option><option value="off">已关机</option></Select>
            <Select aria-label="迁移风险筛选" value={vmRiskFilter} onChange={(event) => { setVmRiskFilter(event.target.value as typeof vmRiskFilter); setVmPage(1); }}><option value="all">全部评估结果</option><option value="warning">迁移警告</option><option value="critical">迁移阻塞</option></Select>
            <label className="select-page-control"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedVMs((current) => event.target.checked ? Array.from(new Set([...current, ...visibleVMIds])) : current.filter((id) => !visibleVMIds.includes(id)))} />选择当前页</label>
            <strong>已选 {selectedVMs.length}</strong>
          </div>
          {pagedVMs.map((vm) => {
            const blockers = effectiveCriticalConcerns(vm);
            const critical = blockers.length > 0;
            const toolsCompatibilityEnabled = skipVMwareToolsSet.has(vm.id) && (vm.concerns || []).some(isVMwareToolsConcern);
            return <label className={`vm-row ${critical ? 'has-critical' : ''}`} key={vm.id}>
              <input type="checkbox" checked={selectedVMs.includes(vm.id)} onChange={(event) => setSelectedVMs((current) => event.target.checked ? [...current, vm.id] : current.filter((id) => id !== vm.id))} />
              <span><strong>{vm.name}</strong><span className="cell-subtitle">{vm.path}</span></span><span>{vm.guestName || '/'}</span><span>{vm.powerState === 'poweredOn' ? '运行中' : vm.powerState === 'poweredOff' ? '已关机' : '状态未知'}</span>
              <span>{critical ? <BlockingStatus vm={vm} concerns={blockers} /> : toolsCompatibilityEnabled ? <StatusBadge tone="warning">已允许无 Tools 迁移</StatusBadge> : vm.concerns?.length ? <StatusBadge tone="warning">迁移警告</StatusBadge> : <StatusBadge tone="success">可迁移</StatusBadge>}</span>
            </label>;
          })}
          {filteredVMs.length === 0 && <div className="wizard-config-empty standalone">没有符合当前筛选条件的虚拟机。</div>}
          <Pagination page={currentVMPage} pageSize={vmPageSize} total={filteredVMs.length} onPageChange={setVmPage} />
        </div>
      </PageState>
    </div>,
    <div key="assessment">
      <h2>迁移评估</h2><p>检查所选虚拟机的迁移阻塞项和迁移警告。迁移警告不会阻止创建任务，但建议在执行前确认。</p>
      {!validationEnabled && <Alert tone="warning" title="迁移检查已关闭">控制台仍会展示已经发现的风险，但不会阻止提交任务。</Alert>}
      {validationEnabled && criticalCount > 0 && <Alert tone="danger" title={`发现 ${criticalCount} 个阻塞项，当前批次暂不可执行`}><div className="alert-action-row"><span>阻塞仅来自 {selectedCriticalVMs.length} 台虚拟机，其他 {migratableSelectedCount} 台可继续准备。请先解决问题，或从当前批次中移除阻塞虚拟机。</span><div className="alert-action-buttons">{vmwareToolsExceptionCandidates.length > 0 && <Button type="button" variant="secondary" onClick={() => enableVMwareToolsCompatibility(vmwareToolsExceptionCandidates.map((vm) => vm.id))}>允许无 VMware Tools 继续迁移（{vmwareToolsExceptionCandidates.length} 台）</Button>}<Button type="button" variant="secondary" onClick={deselectCriticalVMs}>移除阻塞虚拟机（共 {selectedCriticalVMs.length} 台）</Button></div></div></Alert>}
      {concerns.length === 0 ? <Alert tone="success" title="未发现风险">源端资源清单中未发现已知迁移风险。</Alert> : <><div className="concern-summary">共发现 {concerns.length} 项提示，其中 {criticalCount} 项会阻止当前迁移方式。</div><div className="concern-list" style={{ marginTop: 14 }}>{(showAllConcerns ? concerns : concerns.slice(0, 10)).map((concern, index) => <Alert key={`${concern.vm}-${index}`} tone={concern.waived ? 'warning' : concern.blocks ? 'danger' : 'warning'} title={`${concern.vm} · ${concern.waived ? '已允许无 VMware Tools 继续迁移' : concern.blocks ? '迁移阻塞' : '迁移警告'}：${concern.label || '兼容性提示'}`}>{concern.message || concern.assessment}<div className="concern-impact">{concern.waived ? type === 'warm' ? '影响：该项不再阻止任务；预复制不会静默文件系统，业务割接时会直接关闭源虚拟机。' : '影响：该项不再阻止任务；若源虚拟机仍在运行，开始冷迁移时会直接关机。' : concern.blocks ? '影响：当前问题会阻止迁移，请先处理或从任务中移除该虚拟机。' : '影响：不阻止创建和执行当前迁移方式，建议在迁移窗口前确认。'}</div></Alert>)}</div>{concerns.length > 10 && <Button variant="secondary" onClick={() => setShowAllConcerns((value) => !value)}>{showAllConcerns ? '收起其余提示' : `查看其余 ${concerns.length - 10} 项提示`}</Button>}</>}
    </div>,
    <div key="mapping">
      <h2>网络与存储</h2><p>系统已根据所选虚拟机自动识别源网络和源存储。请直接选择迁移后的目标位置，也可以切换为已有配置。</p>
      <section className="wizard-config-section">
        <div className="wizard-config-heading"><span className="wizard-config-icon"><Network size={19} /></span><div><h3>目标网络</h3><p>确认每个源网络在 EIS 目标集群中的接入位置和 IP 处理方式。</p></div></div>
        <div className="wizard-mapping-mode" role="tablist" aria-label="网络配置方式">
          <button type="button" role="tab" aria-selected={networkMappingMode === 'direct'} className={networkMappingMode === 'direct' ? 'active' : ''} onClick={() => { setNetworkMappingMode('direct'); setExpandedMapping(null); }}><Settings2 size={18} /><span><strong>任务专用配置</strong><small>自动带出源网络，只用于当前任务</small></span><em>推荐</em></button>
          <button type="button" role="tab" aria-selected={networkMappingMode === 'existing'} className={networkMappingMode === 'existing' ? 'active' : ''} onClick={() => { setNetworkMappingMode('existing'); setExpandedMapping(null); }}><Library size={18} /><span><strong>选择已有配置</strong><small>复用已经保存的网络对应关系</small></span><em>{networkMaps.length} 项</em></button>
        </div>
        {networkMappingMode === 'direct' ? <div className="wizard-direct-mapping">
          <div className="wizard-auto-source"><Check size={15} /><span>已从 {selectedInventoryVMs.length} 台虚拟机中识别 {networkSources.length} 个源网络，源端无需手动选择。</span><strong>作为当前任务专用配置保存</strong></div>
          {sourceNetworksQuery.error && <Alert tone="warning" title="源网络清单读取不完整">已根据虚拟机信息识别网络，请核对下方源网络标识。</Alert>}
          {targetNetworksQuery.error && <Alert tone="warning" title="目标网络清单暂未同步">仍可在每条规则中选择“手动指定业务网络”，无需退出当前向导。</Alert>}
          {networkSources.length === 0 ? <div className="wizard-config-empty standalone">所选虚拟机中没有可识别的源网络。可切换到“选择已有配置”。</div> : <div className="wizard-direct-list">{networkSources.map((item) => {
            const choice = networkChoices[item.key] || { target: podNetworkValue, networkIPMode: preserveStaticIPs ? 'preserve' : 'dhcp' };
            const businessNetwork = choice.target !== podNetworkValue && choice.target !== ignoredNetworkValue;
            return <div className="wizard-direct-row network" key={item.key}>
              <div className="wizard-direct-source"><span className="wizard-map-icon"><Network size={16} /></span><div><strong>{item.label}</strong><small>资源标识：{item.detail}</small><em>{vmUsageText(item.usedBy)}</em></div></div>
              <ArrowRight className="wizard-map-arrow" size={18} />
              <div className="wizard-direct-target">
                <Field label="迁移后接入"><Select aria-label={`目标网络 ${item.label}`} value={choice.target} onChange={(event) => updateNetworkChoice(item.key, { target: event.target.value })}><option value={podNetworkValue}>默认集群网络</option>{targetNetworks.map((resource) => { const value = destination ? inventoryResourceKey(resource, destination.spec.type) : resource.name; return <option value={value} key={value}>{resource.namespace ? `${resource.namespace} / ` : ''}{resource.name}（业务网络）</option>; })}<option value={customNetworkValue}>手动指定业务网络...</option><option value={ignoredNetworkValue}>不连接此网络</option></Select></Field>
                {businessNetwork
                  ? <Field label="IP 配置"><Select aria-label={`IP 配置 ${item.label}`} value={choice.networkIPMode} onChange={(event) => updateNetworkChoice(item.key, { networkIPMode: event.target.value as NetworkIPMode })}><option value="preserve">保留静态 IP</option><option value="dhcp">自动获取 IP</option><option value="none">不配置 IP</option></Select></Field>
                  : <div className="wizard-network-ip-note"><strong>此处无需设置 IP 处理方式</strong><span>{choice.target === podNetworkValue ? '默认集群网络的映射规则不填写 IP 配置；是否保留静态 IP 请在下一步统一设置。' : '此网卡不会连接到目标网络，因此映射规则不填写 IP 配置。'}</span></div>}
                {choice.target === customNetworkValue && <div className="wizard-custom-network"><Field label="网络所在资源空间"><input aria-label={`业务网络资源空间 ${item.label}`} value={choice.customNamespace || targetNamespace} onChange={(event) => updateNetworkChoice(item.key, { customNamespace: event.target.value })} placeholder={targetNamespace || '例如 vm-workloads'} /></Field><Field label="业务网络名称"><input aria-label={`业务网络名称 ${item.label}`} value={choice.customName || ''} onChange={(event) => updateNetworkChoice(item.key, { customName: event.target.value })} placeholder="请输入目标网络名称" />{!choice.customName?.trim() && <small className="field-error">请填写业务网络名称。</small>}</Field></div>}
              </div>
            </div>;
          })}</div>}
        </div> : <div className="wizard-existing-mapping">
          <div className="wizard-config-picker">
            <div className="wizard-config-search"><Search size={16} /><input aria-label="搜索网络配置" value={networkMapSearch} onChange={(event) => setNetworkMapSearch(event.target.value)} placeholder="搜索名称、源网络或目标网络" /><span>{filteredNetworkMaps.length} 项</span></div>
            <div className="wizard-config-options">{filteredNetworkMaps.map((mapping) => { const selected = mapping.metadata.name === effectiveExistingNetworkMapName; return <button type="button" className={`wizard-config-option ${selected ? 'selected' : ''}`} aria-pressed={selected} key={mapping.metadata.name} onClick={() => { setNetworkMapName(mapping.metadata.name); setExpandedMapping(null); }}><span className="wizard-config-radio">{selected && <Check size={13} />}</span><span><strong>{mapping.metadata.name}</strong><small>{mapping.spec.map.length} 条规则 · {mapping.spec.map.map((item) => networkTarget(item.destination).title).filter((value, index, values) => values.indexOf(value) === index).join('、')}</small></span>{selected && <em>当前选择</em>}</button>; })}{filteredNetworkMaps.length === 0 && <div className="wizard-config-empty">没有可用的已有网络配置，请切换到“任务专用配置”</div>}</div>
          </div>
          {existingNetworkMap && <div className="wizard-selected-config"><div><span><Check size={13} />已选择</span><strong>{existingNetworkMap.metadata.name}</strong><small>包含 {existingNetworkMap.spec.map.length} 条网络规则</small></div><button type="button" aria-expanded={expandedMapping === 'network'} onClick={() => setExpandedMapping((current) => current === 'network' ? null : 'network')}>{expandedMapping === 'network' ? '收起规则' : '查看规则'}{expandedMapping === 'network' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>}
          {existingNetworkMap && expandedMapping === 'network' && <div className="wizard-map-detail"><div className="wizard-map-detail-heading"><strong>网络规则明细</strong><span>已保存的网络配置</span></div><NetworkMapPreview mapping={existingNetworkMap} vms={selectedInventoryVMs} /></div>}
          {existingNetworkMap && !existingNetworkReady && <Alert tone="warning" title="所选网络配置尚未就绪">请先修正该配置并等待状态更新，或改用任务专用配置。</Alert>}
          {missingNetworkSources.length > 0 && <Alert tone="danger" title={`已有网络配置缺少 ${missingNetworkSources.length} 条规则`}>未覆盖：{missingNetworkSources.map((item) => `${item.label}（${vmUsageText(item.usedBy)}）`).join('；')}。请选择其他配置或使用任务专用配置，补齐前不能继续。</Alert>}
          {invalidExistingNetworkRules.length > 0 && <Alert tone="danger" title="已有网络配置包含无效的规则字段">默认集群网络或不连接网络的映射规则不能携带 IP 配置字段。请修正已有配置，或改用任务专用配置；迁移任务中的“保留静态 IP”仍可正常开启。</Alert>}
        </div>}
      </section>
      <section className="wizard-config-section">
        <div className="wizard-config-heading"><span className="wizard-config-icon storage"><HardDrive size={19} /></span><div><h3>目标存储</h3><p>确认每个源存储写入的目标存储，以及磁盘卷和访问方式。</p></div></div>
        <div className="wizard-mapping-mode storage" role="tablist" aria-label="存储配置方式">
          <button type="button" role="tab" aria-selected={storageMappingMode === 'direct'} className={storageMappingMode === 'direct' ? 'active' : ''} onClick={() => { setStorageMappingMode('direct'); setExpandedMapping(null); }}><Settings2 size={18} /><span><strong>任务专用配置</strong><small>自动带出源存储，只用于当前任务</small></span><em>推荐</em></button>
          <button type="button" role="tab" aria-selected={storageMappingMode === 'existing'} className={storageMappingMode === 'existing' ? 'active' : ''} onClick={() => { setStorageMappingMode('existing'); setExpandedMapping(null); }}><Library size={18} /><span><strong>选择已有配置</strong><small>复用已经保存的存储对应关系</small></span><em>{storageMaps.length} 项</em></button>
        </div>
        {storageMappingMode === 'direct' ? <div className="wizard-direct-mapping storage">
          <div className="wizard-auto-source"><Check size={15} /><span>已从 {selectedInventoryVMs.length} 台虚拟机中识别 {storageSources.length} 个源存储，源端无需手动选择。</span><strong>作为当前任务专用配置保存</strong></div>
          {sourceStoragesQuery.error && <Alert tone="warning" title="源存储清单读取不完整">已根据虚拟机磁盘信息识别存储，请核对下方源存储标识。</Alert>}
          {targetStoragesQuery.error && <Alert tone="warning" title="目标存储清单读取失败">当前使用平台默认存储名称，请在提交前确认目标集群中存在该存储。</Alert>}
          {storageSources.length === 0 ? <div className="wizard-config-empty standalone">所选虚拟机中没有可识别的源存储。可切换到“选择已有配置”。</div> : <div className="wizard-direct-list">{storageSources.map((item) => {
            const choice = storageChoices[item.key] || { storageClass: defaultStorageClass, volumeMode: runtimeConfig.defaultVolumeMode, accessMode: runtimeConfig.defaultAccessMode };
            return <div className="wizard-direct-row storage" key={item.key}>
              <div className="wizard-direct-source"><span className="wizard-map-icon storage"><HardDrive size={16} /></span><div><strong>{item.label}</strong><small>资源标识：{item.detail}</small><em>{vmUsageText(item.usedBy)}</em></div></div>
              <ArrowRight className="wizard-map-arrow" size={18} />
              <div className="wizard-direct-target storage">
                <Field label="迁移后存放"><Select aria-label={`目标存储 ${item.label}`} value={choice.storageClass} onChange={(event) => updateStorageChoice(item.key, { storageClass: event.target.value })}>{targetStorageClasses.map((storageClass) => <option value={storageClass} key={storageClass}>{storageClass}{storageClass === defaultStorageClass ? ' · 默认' : ''}</option>)}</Select></Field>
                <Field label="磁盘呈现方式"><Select aria-label={`磁盘呈现方式 ${item.label}`} value={choice.volumeMode} onChange={(event) => updateStorageChoice(item.key, { volumeMode: event.target.value as VolumeMode })}><option value="Block">块设备</option><option value="Filesystem">文件系统</option></Select></Field>
                <Field label="磁盘使用方式"><Select aria-label={`磁盘使用方式 ${item.label}`} value={choice.accessMode} onChange={(event) => updateStorageChoice(item.key, { accessMode: event.target.value as AccessMode })}><option value="ReadWriteMany">多节点读写</option><option value="ReadWriteOnce">单节点读写</option><option value="ReadOnlyMany">多节点只读</option></Select></Field>
              </div>
            </div>;
          })}</div>}
        </div> : <div className="wizard-existing-mapping">
          <div className="wizard-config-picker">
            <div className="wizard-config-search"><Search size={16} /><input aria-label="搜索存储配置" value={storageMapSearch} onChange={(event) => setStorageMapSearch(event.target.value)} placeholder="搜索名称、源存储或目标存储" /><span>{filteredStorageMaps.length} 项</span></div>
            <div className="wizard-config-options">{filteredStorageMaps.map((mapping) => { const selected = mapping.metadata.name === effectiveExistingStorageMapName; return <button type="button" className={`wizard-config-option ${selected ? 'selected' : ''}`} aria-pressed={selected} key={mapping.metadata.name} onClick={() => { setStorageMapName(mapping.metadata.name); setExpandedMapping(null); }}><span className="wizard-config-radio">{selected && <Check size={13} />}</span><span><strong>{mapping.metadata.name}</strong><small>{mapping.spec.map.length} 条规则 · {mapping.spec.map.map((item) => item.destination.storageClass || '/').filter((value, index, values) => values.indexOf(value) === index).join('、')}</small></span>{selected && <em>当前选择</em>}</button>; })}{filteredStorageMaps.length === 0 && <div className="wizard-config-empty">没有可用的已有存储配置，请切换到“任务专用配置”</div>}</div>
          </div>
          {existingStorageMap && <div className="wizard-selected-config storage"><div><span><Check size={13} />已选择</span><strong>{existingStorageMap.metadata.name}</strong><small>包含 {existingStorageMap.spec.map.length} 条存储规则</small></div><button type="button" aria-expanded={expandedMapping === 'storage'} onClick={() => setExpandedMapping((current) => current === 'storage' ? null : 'storage')}>{expandedMapping === 'storage' ? '收起规则' : '查看规则'}{expandedMapping === 'storage' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>}
          {existingStorageMap && expandedMapping === 'storage' && <div className="wizard-map-detail"><div className="wizard-map-detail-heading"><strong>存储规则明细</strong><span>已保存的存储配置</span></div><StorageMapPreview mapping={existingStorageMap} vms={selectedInventoryVMs} /></div>}
          {existingStorageMap && !existingStorageReady && <Alert tone="warning" title="所选存储配置尚未就绪">请先修正该配置并等待状态更新，或改用任务专用配置。</Alert>}
          {missingStorageSources.length > 0 && <Alert tone="danger" title={`已有存储配置缺少 ${missingStorageSources.length} 条规则`}>未覆盖：{missingStorageSources.map((item) => `${item.label}（${vmUsageText(item.usedBy)}）`).join('；')}。请选择其他配置或使用任务专用配置，补齐前不能继续。</Alert>}
        </div>}
      </section>
      {!networkMap && <Alert tone="warning" title="网络配置尚未完成">请为自动识别的源网络选择目标，或切换到已有配置。</Alert>}
      {!storageMap && <Alert tone="warning" title="存储配置尚未完成">请为自动识别的源存储选择目标，或切换到已有配置。</Alert>}
    </div>,
    <div key="options">
      <h2>迁移选项</h2><p>确认源端兼容、目标系统处理、迁移前检查和迁移后状态。</p>
      {source?.spec.type === 'vsphere' && <section className="wizard-settings-section vmware-tools-settings">
        <div className="wizard-settings-heading"><h3>源端 VMware Tools 检查</h3><span>按虚拟机单独设置，不影响同批次其他虚拟机</span></div>
        <p className="settings-section-description">仅在虚拟机未安装、未运行或无法识别 VMware Tools 时开启。{type === 'warm' ? '温迁移会改用非静默快照，并在最终切换时由 vCenter 直接关机。' : '已关机的虚拟机通常无需开启；仍在运行的虚拟机会在冷迁移开始时由 vCenter 直接关机。'}</p>
        <div className="vmware-tools-list">{selectedInventoryVMs.map((vm) => {
          const detected = (vm.concerns || []).some(isVMwareToolsConcern);
          return <Toggle key={vm.id} checked={skipVMwareToolsSet.has(vm.id)} onChange={(enabled) => setVMwareToolsCompatibility(vm.id, enabled)} label={`${vm.name}：未安装 VMware Tools 时仍允许迁移`} description={detected ? `已检测到 VMware Tools 异常。开启后解除该项阻塞，${type === 'warm' ? '快照不做文件系统静默，切换时直接关机' : '运行中的虚拟机会在开始迁移时直接关机'}。` : '当前未检测到 VMware Tools 阻塞，通常无需开启。'} />;
        })}</div>
        {skippedVMwareToolsInventoryVMs.length > 0 && <Alert tone="warning" title={`已允许 ${skippedVMwareToolsInventoryVMs.length} 台无 Tools 虚拟机继续迁移`}>虚拟机：{skippedVMwareToolsInventoryVMs.map((vm) => vm.name).join('、')}。{type === 'warm' ? '预复制快照不会请求客户机静默文件系统，最终切换时将由 vCenter 直接关机。' : '若虚拟机仍在运行，开始冷迁移时将由 vCenter 直接关机。'}请先停止业务写入，并确认可接受强制停机风险。</Alert>}
      </section>}
      <section className="wizard-settings-section">
        <div className="wizard-settings-heading"><h3>目标操作系统处理</h3><span>常规服务器与专用设备镜像采用不同策略</span></div>
        <Alert tone="info" title="网络与安全设备镜像建议">这类镜像通常包含厂商自带的网络和存储驱动，建议关闭下方“适配目标环境驱动”，避免修改镜像内部系统；常规 Linux 或 Windows 服务器建议保持开启。</Alert>
        <div className="wizard-toggle-list">
          <Toggle checked={!skipGuestConversion} onChange={(enabled) => setSkipGuestConversion(!enabled)} label="适配目标环境的磁盘与网络驱动" description="开启后会调整操作系统，使常规服务器能够在 EIS 目标集群启动。关闭后只复制原始磁盘，不修改镜像内部驱动，适合已自行适配的网络设备或安全设备镜像。" />
          {skipGuestConversion && <Alert tone="warning" title="目标驱动适配已关闭">将原样复制磁盘，不再注入目标环境驱动。请确认该专用镜像已经具备目标环境所需驱动，否则虚拟机可能无法启动或联网。</Alert>}
        </div>
      </section>
      <section className="wizard-settings-section">
        <div className="wizard-settings-heading"><h3>迁移前系统与磁盘检查</h3><span>发现高风险问题时阻止任务启动</span></div>
        <div className="wizard-toggle-list">
          <Toggle checked={runPreflightInspection} onChange={setRunPreflightInspection} label="检查磁盘空间、文件系统与操作系统" description="建议保持开启。仅当专用镜像因磁盘分区已满、特殊文件系统或无法识别操作系统而被误判时关闭；关闭检查不会消除实际迁移风险。" />
          {!runPreflightInspection && <Alert tone="warning" title="系统与磁盘检查已关闭">任务不会再因磁盘空间已满、文件系统或操作系统识别问题提前停止，但磁盘复制或目标驱动适配仍可能失败。</Alert>}
        </div>
      </section>
      <section className="wizard-settings-section">
        <div className="wizard-settings-heading"><h3>迁移后虚拟机状态</h3><span>确认网络配置和首次启动方式</span></div>
        <div className="wizard-toggle-list"><Toggle checked={preserveStaticIPs} onChange={setPreserveStaticIPs} label="保留静态 IP" description="源平台支持时，将虚拟机的静态网络配置迁移到目标网络；默认集群网络同样支持此选项。" /><Field label="目标虚拟机电源状态"><Select value={targetPowerState} onChange={(event) => setTargetPowerState(event.target.value as typeof targetPowerState)}><option value="auto">跟随源虚拟机</option><option value="on">迁移后开机</option><option value="off">迁移后关机</option></Select></Field></div>
      </section>
    </div>,
    <div key="review">
      <h2>检查并创建</h2><p>确认迁移范围、网络与存储配置和风险设置。</p>
      {saveError && <Alert tone="danger" title={editingPlan ? '保存任务失败' : '创建任务失败'}>{saveError instanceof Error ? saveError.message : String(saveError)}</Alert>}
      {duplicateTargetVMs.length > 0 && <Alert tone="danger" title="目标资源空间存在同名虚拟机">{duplicateTargetVMs.map((vm) => vm.name).join('、')} 已存在，当前任务不能创建。请返回修改目标资源空间或虚拟机范围。</Alert>}
      <div className="review-list" style={{ marginTop: saveError ? 14 : 0 }}>
        <div className="review-row"><span>任务</span><strong>{name}</strong></div><div className="review-row"><span>迁移路径</span><strong>{effectiveSourceName} → {effectiveDestinationName} / {targetNamespace}</strong></div>
        <div className="review-row"><span>迁移方式与虚拟机</span><strong>{migrationModes[type].title} / {selectedVMs.length} 台</strong></div><div className="review-row"><span>网络配置</span><strong>{effectiveNetworkMapName || '/'}{networkMappingMode === 'direct' ? '（任务专用）' : '（已有配置）'}</strong></div>
        <div className="review-row"><span>存储配置</span><strong>{effectiveStorageMapName || '/'}{storageMappingMode === 'direct' ? '（任务专用）' : '（已有配置）'}</strong></div><div className="review-row"><span>目标存储</span><strong>{firstStorageTarget ? `${firstStorageTarget.storageClass || '/'} / 呈现方式：${firstStorageTarget.volumeMode || '/'} / 使用方式：${firstStorageTarget.accessMode || '/'}` : '/'}</strong></div>
        <div className="review-row"><span>目标驱动适配</span><strong>{skipGuestConversion ? '关闭（原样复制磁盘）' : '开启（常规服务器推荐）'}</strong></div><div className="review-row"><span>系统与磁盘检查</span><strong>{runPreflightInspection ? '开启' : '关闭（风险）'}</strong></div>
        <div className="review-row"><span>静态 IP</span><strong>{preserveStaticIPs ? '保留' : '不保留'}</strong></div>
        {source?.spec.type === 'vsphere' && <div className="review-row"><span>无 VMware Tools 迁移</span><strong>{skippedVMwareToolsInventoryVMs.length ? `${skippedVMwareToolsInventoryVMs.length} 台：${skippedVMwareToolsInventoryVMs.map((vm) => vm.name).join('、')}` : '未允许'}</strong></div>}
      </div>
      {(!runPreflightInspection || skipGuestConversion || !validationEnabled || skippedVMwareToolsInventoryVMs.length > 0) && <Alert tone="warning" title="该任务包含风险配置">执行前请记录关闭系统与磁盘检查、关闭目标驱动适配或允许无 VMware Tools 迁移的原因，并保留回滚窗口。</Alert>}
    </div>,
  ][step];

  return <>
    <div className="page-heading"><div><h2>{editingPlan ? '编辑迁移任务' : '创建迁移任务'}</h2><p>{editingPlan ? '调整尚未执行的迁移范围、网络与存储配置和执行策略。' : '按步骤选择工作负载、完成评估并配置迁移策略。'}</p></div></div>
    <div className="wizard-shell">
      <nav ref={wizardNavRef} className="wizard-nav" aria-label="迁移任务创建步骤">{steps.map((label, index) => <button key={label} className={`wizard-step ${step === index ? 'active' : ''} ${step > index ? 'done' : ''}`} aria-current={step === index ? 'step' : undefined} onClick={() => index <= step && setStep(index)}><span className="wizard-step-index">{step > index ? <Check size={13} /> : index + 1}</span><span className="wizard-step-copy"><strong>{label}</strong><small>{stepHints[index]}</small></span></button>)}</nav>
      <section className={`wizard-content ${step === steps.length - 1 ? 'has-split-submit' : ''}`}>
        {stepBody}
        <footer className={`wizard-footer ${step === steps.length - 1 ? 'has-split-submit' : ''}`}><div><Button variant="ghost" onClick={() => navigate(editingPlan ? `/plans/${editingPlan.metadata.name}` : '/plans')}>取消</Button>{step > 0 && <Button variant="secondary" icon={<ChevronLeft size={16} />} onClick={() => setStep((value) => value - 1)}>上一步</Button>}{step < steps.length - 1 ? <Button disabled={!valid[step]} onClick={() => setStep((value) => value + 1)}>下一步<ChevronRight size={16} /></Button> : <><Button variant="secondary" disabled={savePending || !valid.every(Boolean)} icon={submissionMode === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} onClick={() => submit(false)}>{submissionMode === 'save' ? '正在保存...' : '仅保存任务'}</Button><Button disabled={savePending || !valid.every(Boolean)} icon={submissionMode === 'start' ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} onClick={() => submit(true)}>{submissionMode === 'start' ? '等待就绪并启动...' : '保存并立即开始迁移'}</Button></>}</div></footer>
      </section>
    </div>
    <Modal open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="离开当前任务创建页面？" description="尚未保存的迁移配置会丢失。"
      footer={<><Button variant="secondary" onClick={() => blocker.reset?.()}>继续编辑</Button><Button variant="danger" onClick={() => { allowNavigationRef.current = true; blocker.proceed?.(); }}>放弃修改并离开</Button></>}>
      <Alert tone="warning" title="尚有未保存内容">已填写的环境、虚拟机、网络、存储或迁移选项尚未保存。</Alert>
    </Modal>
  </>;
}
