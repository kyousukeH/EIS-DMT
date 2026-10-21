import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, HardDrive,
  LoaderCircle, Network, Radio, RefreshCw, Save, Search, Snowflake,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useControllers, useCreateResource, useInventoryNamespaces, useInventoryVMs,
  useNetworkMaps, usePatchResource, usePlans, useProviders, useStorageMaps,
} from '../api/hooks';
import { getRuntimeConfig } from '../api/client';
import { buildPlan } from '../domain/builders';
import { inventoryVMNamespace, vmResourceRefs } from '../domain/inventory';
import { getPlanMigrationType, isPlanEditable } from '../domain/status';
import type { InventoryVM, MappingRef, MigrationType, NetworkMap, Plan, StorageMap } from '../domain/types';
import { isEISTargetProvider, isSourceProvider } from '../domain/providers';
import { Alert, Button, Field, PageState, Select, StatusBadge, Toggle } from '../components/ui';

const steps = ['基本信息', '选择虚拟机', '迁移评估', '网络与存储', '迁移设置', '检查并创建'];
const stepHints = ['迁移批次', '迁移范围', '风险确认', '资源配置', '执行策略', '检查提交'];
const planNamePattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

type SelectableMigrationType = Exclude<MigrationType, 'conversion'>;

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
    description: '用于支持实时迁移的 KubeVirt 源集群，尽量保持虚拟机持续运行。',
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
    return { title: 'Multus 网络', detail: `${destination.namespace || '/'} / ${destination.name || '/'}` };
  }
  if (destination.type === 'ignored') return { title: '不连接目标网络', detail: '迁移后不连接此网卡' };
  return { title: 'Pod 网络', detail: '目标集群 Pod 网络' };
}

function networkIPModeLabel(mode?: NetworkMap['spec']['map'][number]['networkIPMode']) {
  if (mode === 'dhcp') return '自动获取 IP';
  if (mode === 'none') return '不配置 IP';
  return '保留静态 IP';
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

function BlockingStatus({ vm }: { vm: InventoryVM }) {
  const blockers = (vm.concerns || []).filter((concern) => concern.category === 'Critical');
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
  if (!plan) return <Alert tone="danger" title="计划不存在">无法找到迁移计划 {editingName}。<div style={{ marginTop: 8 }}><Link to="/plans">返回列表</Link></div></Alert>;
  if (!isPlanEditable(plan)) return <Alert tone="warning" title="该计划不能修改">已经启动、正在执行或已归档的迁移计划不能直接修改。<div style={{ marginTop: 8 }}><Link to={`/plans/${plan.metadata.name}`}>返回计划详情</Link></div></Alert>;
  return <PlanWizardForm plan={plan} plans={plans} />;
}

function PlanWizardForm({ plan: editingPlan, plans }: { plan?: Plan; plans: Plan[] }) {
  const navigate = useNavigate();
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
  const [networkMapName, setNetworkMapName] = useState(editingPlan?.spec.map.network.name || '');
  const [storageMapName, setStorageMapName] = useState(editingPlan?.spec.map.storage.name || '');
  const [networkMapSearch, setNetworkMapSearch] = useState('');
  const [storageMapSearch, setStorageMapSearch] = useState('');
  const [expandedMapping, setExpandedMapping] = useState<'network' | 'storage' | null>(null);
  const [skipGuestConversion, setSkipGuestConversion] = useState(editingPlan?.spec.skipGuestConversion ?? false);
  const [runPreflightInspection, setRunPreflightInspection] = useState(editingPlan?.spec.runPreflightInspection ?? true);
  const [targetPowerState, setTargetPowerState] = useState<'on' | 'off' | 'auto'>(editingPlan?.spec.targetPowerState || 'auto');
  const [preserveStaticIPs, setPreserveStaticIPs] = useState(editingPlan?.spec.preserveStaticIPs ?? true);

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
  const effectiveSourceName = sourceName || sourceProviders[0]?.metadata.name || '';
  const effectiveDestinationName = targetProviders.some((provider) => provider.metadata.name === destinationName)
    ? destinationName : targetProviders[0]?.metadata.name || '';
  const source = providers.find((provider) => provider.metadata.name === effectiveSourceName);
  const destination = providers.find((provider) => provider.metadata.name === effectiveDestinationName);
  const vmQuery = useInventoryVMs(source);
  const targetVMQuery = useInventoryVMs(destination);
  const namespaceQuery = useInventoryNamespaces(destination);
  const targetNamespaces = (namespaceQuery.data || []).slice().sort((left, right) => left.name.localeCompare(right.name));
  if (targetNamespace && !targetNamespaces.some((namespace) => namespace.name === targetNamespace)) targetNamespaces.unshift({ name: targetNamespace });
  const networkMaps = (networkMapsQuery.data?.items || []).filter((mapping) =>
    (!effectiveSourceName || mapping.spec.provider.source.name === effectiveSourceName)
    && (!effectiveDestinationName || mapping.spec.provider.destination.name === effectiveDestinationName));
  const storageMaps = (storageMapsQuery.data?.items || []).filter((mapping) =>
    (!effectiveSourceName || mapping.spec.provider.source.name === effectiveSourceName)
    && (!effectiveDestinationName || mapping.spec.provider.destination.name === effectiveDestinationName));
  const effectiveNetworkMapName = networkMaps.some((mapping) => mapping.metadata.name === networkMapName)
    ? networkMapName : networkMaps[0]?.metadata.name || '';
  const effectiveStorageMapName = storageMaps.some((mapping) => mapping.metadata.name === storageMapName)
    ? storageMapName : storageMaps[0]?.metadata.name || '';
  const networkMap = networkMaps.find((mapping) => mapping.metadata.name === effectiveNetworkMapName);
  const storageMap = storageMaps.find((mapping) => mapping.metadata.name === effectiveStorageMapName);
  const filteredNetworkMaps = networkMaps.filter((mapping) =>
    `${mapping.metadata.name} ${mapping.spec.map.flatMap((item) => [sourceIdentifier(item.source), networkTarget(item.destination).title, networkTarget(item.destination).detail]).join(' ')}`
      .toLowerCase().includes(networkMapSearch.trim().toLowerCase()));
  const filteredStorageMaps = storageMaps.filter((mapping) =>
    `${mapping.metadata.name} ${mapping.spec.map.flatMap((item) => [sourceIdentifier(item.source), item.destination.storageClass, item.destination.volumeMode, item.destination.accessMode]).join(' ')}`
      .toLowerCase().includes(storageMapSearch.trim().toLowerCase()));
  const validationEnabled = controllersQuery.data?.items[0]?.spec.feature_validation !== 'false';

  const selectedInventoryVMs = (vmQuery.data || []).filter((vm) => selectedVMs.includes(vm.id));
  const selectedCriticalVMs = selectedInventoryVMs.filter((vm) => vm.concerns?.some((concern) => concern.category === 'Critical'));
  const targetNamespaceVMs = (targetVMQuery.data || []).filter((vm) => inventoryVMNamespace(vm) === targetNamespace);
  const targetNames = new Set(targetNamespaceVMs.map((vm) => vm.name.toLowerCase()));
  const duplicateTargetVMs = selectedInventoryVMs.filter((vm) => targetNames.has(vm.name.toLowerCase()));
  const concerns = selectedInventoryVMs.flatMap((vm) => (vm.concerns || []).map((concern) => ({ ...concern, vm: vm.name })));
  const criticalCount = concerns.filter((concern) => concern.category === 'Critical').length;
  const filteredVMs = useMemo(() => (vmQuery.data || []).filter((vm) => `${vm.name} ${vm.path || ''} ${vm.guestName || ''}`.toLowerCase().includes(vmSearch.toLowerCase())), [vmQuery.data, vmSearch]);
  const planNameExists = !editingPlan && plans.some((plan) => plan.metadata.name === name);
  const planNameValid = Boolean(name && name.length <= 63 && planNamePattern.test(name) && !planNameExists);

  const valid = [
    Boolean(planNameValid && source && destination && targetNamespace && !targetVMQuery.isLoading),
    selectedVMs.length > 0 && duplicateTargetVMs.length === 0 && (!validationEnabled || selectedCriticalVMs.length === 0) && !targetVMQuery.isLoading,
    !validationEnabled || criticalCount === 0,
    Boolean(networkMap && storageMap),
    Boolean(type),
    true,
  ];

  const submit = () => {
    if (!planNameValid || !source || !destination || !networkMap || !storageMap || !valid.every(Boolean)) return;
    const nextPlan = buildPlan({
      name, namespace: getRuntimeConfig().namespace, description, targetNamespace, type,
      source, destination, networkMap, storageMap, vmIds: selectedVMs, skipGuestConversion,
      runPreflightInspection, targetPowerState, preserveStaticIPs,
    });
    if (editingPlan) {
      const existingVMs = new Map(editingPlan.spec.vms.map((vm) => [vm.id, vm]));
      nextPlan.spec = {
        ...editingPlan.spec,
        ...nextPlan.spec,
        vms: selectedVMs.map((id) => existingVMs.get(id) || { id }),
      };
      patchPlan.mutate(
        { name: editingPlan.metadata.name, patch: { spec: nextPlan.spec } },
        { onSuccess: () => navigate(`/plans/${editingPlan.metadata.name}`) },
      );
    } else {
      createPlan.mutate(nextPlan, { onSuccess: () => navigate(`/plans/${name}`) });
    }
  };

  const savePending = createPlan.isPending || patchPlan.isPending;
  const saveError = createPlan.error || patchPlan.error;
  const firstStorageTarget = storageMap?.spec.map[0]?.destination;

  const stepBody = [
    <div key="general">
      <h2>基本信息</h2><p>先确定迁移批次、源集群和目标命名空间，再选择虚拟机。</p>
      <div className="form-grid">
        <Field label="计划名称" required help={!name || planNameValid ? '仅支持小写字母、数字和连字符，最长 63 个字符；创建后不可修改。' : undefined}>
          <input value={name} disabled={Boolean(editingPlan)} maxLength={63} aria-invalid={Boolean(name && !planNameValid)} onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, ''))} placeholder="erp-wave-01" pattern="[a-z0-9](?:[-a-z0-9]*[a-z0-9])?" />
          {name && !planNamePattern.test(name) && <small className="field-error">名称必须以字母或数字开头和结尾，中间只能使用小写字母、数字和连字符。</small>}
          {planNameExists && <small className="field-error">已经存在同名迁移计划，请使用其他名称。</small>}
        </Field>
        <Field label="目标命名空间" required><Select value={targetNamespace} onChange={(event) => setTargetNamespace(event.target.value)} disabled={!destination || namespaceQuery.isLoading}><option value="">{namespaceQuery.isLoading ? '正在加载...' : '请选择目标命名空间'}</option>{targetNamespaces.map((namespace) => <option value={namespace.name} key={namespace.name}>{namespace.name}</option>)}</Select>{namespaceQuery.error && <small className="field-error">目标命名空间加载失败：{namespaceQuery.error.message}</small>}</Field>
        <Field label="源集群" required><Select value={effectiveSourceName} onChange={(event) => { const value = event.target.value; setSourceName(value); setSelectedVMs([]); setNetworkMapName(''); setStorageMapName(''); const nextSource = providers.find((provider) => provider.metadata.name === value); if (nextSource && !migrationSupport[type].includes(nextSource.spec.type)) setType('cold'); }}>{sourceProviders.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
        <Field label="EIS 目标集群" required><Select value={effectiveDestinationName} onChange={(event) => { setDestinationName(event.target.value); setTargetNamespace(''); setNetworkMapName(''); setStorageMapName(''); }}>{targetProviders.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
        <Field label="描述"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明本批次的业务范围和变更窗口" /></Field>
      </div>
      {targetNamespace && targetNamespaceVMs.length > 0 && <div style={{ marginTop: 18 }}><Alert tone="warning" title={`目标命名空间已有 ${targetNamespaceVMs.length} 台虚拟机`}>系统会在选择虚拟机时检查名称冲突。若迁移同名虚拟机，请改用其他目标命名空间，避免覆盖或创建失败。</Alert></div>}
      {targetVMQuery.error && <div style={{ marginTop: 18 }}><Alert tone="warning" title="暂时无法检查目标虚拟机">目标资源清单读取失败，创建计划前请确认目标命名空间中没有同名虚拟机。</Alert></div>}
      {requestedVMs.length > 0 && <div style={{ marginTop: 18 }}><Alert tone="info" title="已带入虚拟机">已从资源列表选择 {requestedVMs.length} 台虚拟机。完成基本信息后，可在下一步核对迁移范围。</Alert></div>}
    </div>,
    <div key="vms">
      <h2>选择虚拟机</h2><p>从源集群资源清单中选择本次迁移的虚拟机。将鼠标移到“阻塞”状态上可查看原因。</p>
      {duplicateTargetVMs.length > 0 && <Alert tone="danger" title={`发现 ${duplicateTargetVMs.length} 台同名虚拟机`}>目标命名空间 <strong>{targetNamespace}</strong> 已存在：{duplicateTargetVMs.map((vm) => vm.name).join('、')}。请取消选择这些虚拟机，或返回上一步更换目标命名空间。</Alert>}
      {validationEnabled && selectedCriticalVMs.length > 0 && <div className="wizard-inline-alert"><Alert tone="danger" title="所选虚拟机包含迁移阻塞项">{selectedCriticalVMs.map((vm) => vm.name).join('、')} 暂时不能进入下一步。请取消选择，或处理阻塞原因后重新检查。</Alert></div>}
      <PageState loading={vmQuery.isLoading} error={vmQuery.error} empty={!source} emptyText="请先选择源环境">
        <div className="vm-picker">
          <div className="vm-picker-header"><input className="input" style={{ width: 320 }} value={vmSearch} onChange={(event) => setVmSearch(event.target.value)} placeholder="搜索虚拟机、路径或操作系统" /><strong>已选 {selectedVMs.length}</strong></div>
          {filteredVMs.map((vm) => {
            const critical = vm.concerns?.some((concern) => concern.category === 'Critical');
            return <label className={`vm-row ${critical ? 'has-critical' : ''}`} key={vm.id}>
              <input type="checkbox" checked={selectedVMs.includes(vm.id)} onChange={(event) => setSelectedVMs((current) => event.target.checked ? [...current, vm.id] : current.filter((id) => id !== vm.id))} />
              <span><strong>{vm.name}</strong><span className="cell-subtitle">{vm.path}</span></span><span>{vm.guestName || '/'}</span><span>{vm.powerState || '/'}</span>
              <span>{critical ? <BlockingStatus vm={vm} /> : vm.concerns?.length ? <StatusBadge tone="warning">需关注</StatusBadge> : <StatusBadge tone="success">正常</StatusBadge>}</span>
            </label>;
          })}
        </div>
      </PageState>
    </div>,
    <div key="assessment">
      <h2>迁移评估</h2><p>检查所选虚拟机的阻塞项和潜在风险。</p>
      {!validationEnabled && <Alert tone="warning" title="迁移检查已关闭">控制台仍会展示已经发现的风险，但不会阻止提交计划。</Alert>}
      {validationEnabled && criticalCount > 0 && <Alert tone="danger" title={`发现 ${criticalCount} 个阻塞项`}>请先解决阻塞问题，或由管理员在“系统设置”中临时关闭迁移检查。关闭后会影响所有迁移计划。</Alert>}
      {concerns.length === 0 ? <Alert tone="success" title="未发现风险">源集群资源清单中未发现已知迁移风险。</Alert> : <div className="concern-list" style={{ marginTop: 14 }}>{concerns.map((concern, index) => <Alert key={`${concern.vm}-${index}`} tone={concern.category === 'Critical' ? 'danger' : concern.category === 'Warning' ? 'warning' : 'info'} title={`${concern.vm} · ${concern.label || concern.category}`}>{concern.message || concern.assessment}</Alert>)}</div>}
    </div>,
    <div key="mapping">
      <h2>网络与存储</h2><p>为本批次选择已配置的网络和存储规则，并核对每条源资源关联的虚拟机。</p>
      <section className="wizard-config-section">
        <div className="wizard-config-heading"><span className="wizard-config-icon"><Network size={19} /></span><div><h3>网络配置</h3><p>源网络将连接到目标集群的 Pod 网络或 Multus 网络。</p></div></div>
        <div className="wizard-config-picker">
          <div className="wizard-config-search"><Search size={16} /><input aria-label="搜索网络配置" value={networkMapSearch} onChange={(event) => setNetworkMapSearch(event.target.value)} placeholder="搜索名称、源网络或目标网络" /><span>{filteredNetworkMaps.length} 项</span></div>
          <div className="wizard-config-options">{filteredNetworkMaps.map((mapping) => { const selected = mapping.metadata.name === effectiveNetworkMapName; return <button type="button" className={`wizard-config-option ${selected ? 'selected' : ''}`} aria-pressed={selected} key={mapping.metadata.name} onClick={() => { setNetworkMapName(mapping.metadata.name); setExpandedMapping(null); }}><span className="wizard-config-radio">{selected && <Check size={13} />}</span><span><strong>{mapping.metadata.name}</strong><small>{mapping.spec.map.length} 条规则 · {mapping.spec.map.map((item) => networkTarget(item.destination).title).filter((value, index, values) => values.indexOf(value) === index).join('、')}</small></span>{selected && <em>当前选择</em>}</button>; })}{filteredNetworkMaps.length === 0 && <div className="wizard-config-empty">没有匹配的网络配置</div>}</div>
        </div>
        {networkMap && <div className="wizard-selected-config"><div><span><Check size={13} />已选择</span><strong>{networkMap.metadata.name}</strong><small>包含 {networkMap.spec.map.length} 条网络规则</small></div><button type="button" aria-expanded={expandedMapping === 'network'} onClick={() => setExpandedMapping((current) => current === 'network' ? null : 'network')}>{expandedMapping === 'network' ? '收起规则' : '查看规则'}{expandedMapping === 'network' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>}
        {networkMap && expandedMapping === 'network' && <div className="wizard-map-detail"><div className="wizard-map-detail-heading"><strong>网络规则明细</strong><span>仅供核对，修改请前往网络与存储配置</span></div><NetworkMapPreview mapping={networkMap} vms={selectedInventoryVMs} /></div>}
      </section>
      <section className="wizard-config-section">
        <div className="wizard-config-heading"><span className="wizard-config-icon storage"><HardDrive size={19} /></span><div><h3>存储配置</h3><p>源存储将写入指定的目标存储，并使用配置中的卷模式和访问模式。</p></div></div>
        <div className="wizard-config-picker">
          <div className="wizard-config-search"><Search size={16} /><input aria-label="搜索存储配置" value={storageMapSearch} onChange={(event) => setStorageMapSearch(event.target.value)} placeholder="搜索名称、源存储或目标存储" /><span>{filteredStorageMaps.length} 项</span></div>
          <div className="wizard-config-options">{filteredStorageMaps.map((mapping) => { const selected = mapping.metadata.name === effectiveStorageMapName; return <button type="button" className={`wizard-config-option ${selected ? 'selected' : ''}`} aria-pressed={selected} key={mapping.metadata.name} onClick={() => { setStorageMapName(mapping.metadata.name); setExpandedMapping(null); }}><span className="wizard-config-radio">{selected && <Check size={13} />}</span><span><strong>{mapping.metadata.name}</strong><small>{mapping.spec.map.length} 条规则 · {mapping.spec.map.map((item) => item.destination.storageClass || '/').filter((value, index, values) => values.indexOf(value) === index).join('、')}</small></span>{selected && <em>当前选择</em>}</button>; })}{filteredStorageMaps.length === 0 && <div className="wizard-config-empty">没有匹配的存储配置</div>}</div>
        </div>
        {storageMap && <div className="wizard-selected-config storage"><div><span><Check size={13} />已选择</span><strong>{storageMap.metadata.name}</strong><small>包含 {storageMap.spec.map.length} 条存储规则</small></div><button type="button" aria-expanded={expandedMapping === 'storage'} onClick={() => setExpandedMapping((current) => current === 'storage' ? null : 'storage')}>{expandedMapping === 'storage' ? '收起规则' : '查看规则'}{expandedMapping === 'storage' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>}
        {storageMap && expandedMapping === 'storage' && <div className="wizard-map-detail"><div className="wizard-map-detail-heading"><strong>存储规则明细</strong><span>仅供核对，修改请前往网络与存储配置</span></div><StorageMapPreview mapping={storageMap} vms={selectedInventoryVMs} /></div>}
      </section>
      {(!networkMaps.length || !storageMaps.length) && <Alert tone="warning" title="网络与存储配置不完整">请先到“网络与存储配置”页面，为当前源集群选择迁移后的网络和存储。<div style={{ marginTop: 9 }}><Link to="/mappings">前往配置</Link></div></Alert>}
    </div>,
    <div key="options">
      <h2>迁移设置</h2><p>选择迁移方式，并确认系统适配、迁移检查和目标虚拟机行为。</p>
      <section className="wizard-settings-section">
        <div className="wizard-settings-heading"><h3>迁移方式</h3><span>系统会根据源集群能力限制可选方式</span></div>
        <div className="migration-mode-grid">{(Object.keys(migrationModes) as SelectableMigrationType[]).map((mode) => {
          const details = migrationModes[mode];
          const Icon = details.icon;
          const supported = !source || migrationSupport[mode].includes(source.spec.type);
          return <button type="button" className={`migration-mode-card ${type === mode ? 'selected' : ''}`} disabled={!supported} aria-pressed={type === mode} key={mode} onClick={() => setType(mode)}>
            <span className="migration-mode-icon"><Icon size={20} /></span><strong>{details.title}</strong><small>{supported ? details.subtitle : '当前源集群不支持'}</small><p>{details.description}</p><span className="migration-mode-benefits">{details.benefits.map((benefit) => <em key={benefit}><Check size={12} />{benefit}</em>)}</span>
          </button>;
        })}</div>
        {type === 'warm' && <Alert tone="info" title="温迁移执行方式">创建计划后先执行预复制，预热完成后可在计划详情中立即切换或预约切换时间。</Alert>}
      </section>
      <section className="wizard-settings-section">
        <div className="wizard-settings-heading"><h3>系统与目标虚拟机</h3><span>建议保留推荐设置，特殊镜像可按风险评估调整</span></div>
        <div className="wizard-toggle-list">
          <Toggle checked={!skipGuestConversion} onChange={(enabled) => setSkipGuestConversion(!enabled)} label="执行系统适配" description="默认启用。迁移时会适配目标环境所需的网络与磁盘驱动；镜像包含特殊网络设备时建议保持启用。关闭后只复制原始磁盘，目标系统必须已具备所需驱动。" />
          {skipGuestConversion && <Alert tone="warning" title="系统适配已关闭">目标虚拟机可能因缺少驱动而无法启动或无法联网。仅对已经完成目标环境适配的镜像使用。</Alert>}
          <Toggle checked={runPreflightInspection} onChange={setRunPreflightInspection} label="执行迁移前检查" description="关闭后不再因磁盘空间已满、文件系统或操作系统检查失败而提前阻止，但实际复制或系统适配阶段仍可能失败。" />
          {!runPreflightInspection && <Alert tone="warning" title="迁移前检查已关闭">请确认已经评估磁盘已满、文件系统损坏和驱动不兼容风险。</Alert>}
          <Toggle checked={preserveStaticIPs} onChange={setPreserveStaticIPs} label="保留静态 IP" description="源平台支持时，将虚拟机的静态网络配置迁移到目标网络。" />
          <Field label="目标虚拟机电源状态"><Select value={targetPowerState} onChange={(event) => setTargetPowerState(event.target.value as typeof targetPowerState)}><option value="auto">跟随源虚拟机</option><option value="on">迁移后开机</option><option value="off">迁移后关机</option></Select></Field>
        </div>
      </section>
    </div>,
    <div key="review">
      <h2>检查并创建</h2><p>确认迁移范围、网络与存储配置和风险设置。</p>
      {saveError && <Alert tone="danger" title={editingPlan ? '保存计划失败' : '创建计划失败'}>{saveError.message}</Alert>}
      {duplicateTargetVMs.length > 0 && <Alert tone="danger" title="目标命名空间存在同名虚拟机">{duplicateTargetVMs.map((vm) => vm.name).join('、')} 已存在，当前计划不能创建。请返回修改目标命名空间或虚拟机范围。</Alert>}
      <div className="review-list" style={{ marginTop: saveError ? 14 : 0 }}>
        <div className="review-row"><span>计划</span><strong>{name}</strong></div><div className="review-row"><span>迁移路径</span><strong>{effectiveSourceName} → {effectiveDestinationName} / {targetNamespace}</strong></div>
        <div className="review-row"><span>迁移方式与虚拟机</span><strong>{migrationModes[type].title} / {selectedVMs.length} 台</strong></div><div className="review-row"><span>网络配置</span><strong>{effectiveNetworkMapName || '/'}</strong></div>
        <div className="review-row"><span>存储配置</span><strong>{effectiveStorageMapName || '/'}</strong></div><div className="review-row"><span>目标存储</span><strong>{firstStorageTarget ? `${firstStorageTarget.storageClass || '/'} / 卷模式：${firstStorageTarget.volumeMode || '/'} / 访问模式：${firstStorageTarget.accessMode || '/'}` : '/'}</strong></div>
        <div className="review-row"><span>系统适配</span><strong>{skipGuestConversion ? '关闭（风险）' : '启用（推荐）'}</strong></div><div className="review-row"><span>迁移前检查</span><strong>{runPreflightInspection ? '启用' : '关闭（风险）'}</strong></div>
      </div>
      {(!runPreflightInspection || skipGuestConversion || !validationEnabled) && <Alert tone="warning" title="该计划包含风险配置">执行前请在变更记录中说明关闭检查或系统适配的原因，并保留回滚窗口。</Alert>}
    </div>,
  ][step];

  return <>
    <div className="page-heading"><div><span className="eyebrow">{editingPlan ? '调整迁移配置' : '跟随向导迁移'}</span><h2>{editingPlan ? '编辑迁移计划' : '创建迁移计划'}</h2><p>{editingPlan ? '调整尚未执行的迁移范围、网络与存储配置和执行策略。' : '按步骤选择工作负载、完成评估并配置迁移策略。'}</p></div></div>
    <div className="wizard-shell">
      <nav ref={wizardNavRef} className="wizard-nav" aria-label="迁移计划创建步骤">{steps.map((label, index) => <button key={label} className={`wizard-step ${step === index ? 'active' : ''} ${step > index ? 'done' : ''}`} aria-current={step === index ? 'step' : undefined} onClick={() => index <= step && setStep(index)}><span className="wizard-step-index">{step > index ? <Check size={13} /> : index + 1}</span><span className="wizard-step-copy"><strong>{label}</strong><small>{stepHints[index]}</small></span></button>)}</nav>
      <section className="wizard-content">
        {stepBody}
        <footer className="wizard-footer"><div><Button variant="ghost" onClick={() => navigate(editingPlan ? `/plans/${editingPlan.metadata.name}` : '/plans')}>取消</Button>{step > 0 && <Button variant="secondary" icon={<ChevronLeft size={16} />} onClick={() => setStep((value) => value - 1)}>上一步</Button>}{step < steps.length - 1 ? <Button disabled={!valid[step]} onClick={() => setStep((value) => value + 1)}>下一步<ChevronRight size={16} /></Button> : <Button disabled={savePending || !valid.every(Boolean)} icon={savePending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} onClick={submit}>{savePending ? '正在保存...' : editingPlan ? '保存修改' : '创建计划'}</Button>}</div></footer>
      </section>
    </div>
  </>;
}
