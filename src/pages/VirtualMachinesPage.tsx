import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Cpu, Eye, HardDrive, History, Monitor, Network,
  LoaderCircle, Power, PowerOff, RefreshCw, Search, Server, ShieldCheck, Trash2, Zap,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInventoryVMs, usePlans, useProviders } from '../api/hooks';
import { deleteTargetVirtualMachine, setTargetVirtualMachinePower, type TargetVirtualMachineAction } from '../api/client';
import { formatBytes } from '../domain/format';
import {
  configuredDiskBytes,
  configuredDiskCapacityBytes,
  configuredDisks,
  inventoryCpuCount,
  inventoryMemoryMB,
  inventoryPowerPresentation,
  inventoryPowerState,
  inventoryVMNamespace,
  isVMwareToolsConcern,
  migratedTargetVMs,
  targetVMKey,
} from '../domain/inventory';
import { isEISTargetProvider, isLocalEISTargetProvider, isSourceProvider } from '../domain/providers';
import type { InventoryVM } from '../domain/types';
import { Alert, Button, ConfirmDialog, Modal, PageState, Pagination, Select, StatusBadge } from '../components/ui';

function hasConcern(vm: InventoryVM, category: string) {
  return vm.concerns?.some((concern) => concern.category.toLowerCase() === category.toLowerCase());
}

function hasMigrationWarning(vm: InventoryVM) {
  return vm.concerns?.some((concern) => concern.category.toLowerCase() !== 'critical');
}

function hasVMwareToolsCompatibility(vm: InventoryVM, sourceType?: string) {
  const blockers = (vm.concerns || []).filter((concern) => concern.category.toLowerCase() === 'critical');
  return sourceType === 'vsphere' && blockers.length > 0 && blockers.every(isVMwareToolsConcern);
}

function formatMemory(value?: number) {
  if (!value) return '-';
  return value >= 1024 ? `${Math.round(value / 1024)} GiB` : `${value} MiB`;
}

function migrationLink(provider: string, vmIds: string[]) {
  const params = new URLSearchParams({ provider });
  vmIds.forEach((id) => params.append('vm', id));
  return `/plans/new?${params.toString()}`;
}

function ResourceSpec({ vm }: { vm: InventoryVM }) {
  const diskBytes = configuredDiskBytes(vm);
  const disks = configuredDisks(vm);
  const systemBytes = disks.filter((disk) => disk.role === 'system').reduce((total, disk) => total + configuredDiskCapacityBytes(disk), 0);
  const dataDisks = disks.filter((disk) => disk.role !== 'system');
  const dataBytes = dataDisks.reduce((total, disk) => total + configuredDiskCapacityBytes(disk), 0);
  const diskLabel = disks.length
    ? [
      `系统盘 ${systemBytes ? formatBytes(systemBytes) : '容量读取中'}`,
      ...(dataDisks.length ? [`数据盘 ${dataBytes ? formatBytes(dataBytes) : '容量读取中'}（${dataDisks.length} 块）`] : []),
    ].join(' · ')
    : diskBytes ? `磁盘 ${formatBytes(diskBytes)}` : '磁盘容量读取中';
  return <span className="resource-spec">
    <span><Cpu size={13} />{inventoryCpuCount(vm) || '-'} vCPU</span>
    <span>{formatMemory(inventoryMemoryMB(vm))}</span>
    <span className="disk-capacity-summary" title={diskBytes ? `配置总容量 ${formatBytes(diskBytes)}` : '正在读取虚拟机引用的磁盘容量'}><HardDrive size={13} /><span>{diskBytes ? formatBytes(diskBytes) : '-'}</span><small>{diskLabel}</small></span>
  </span>;
}

type TargetVMTransition = {
  action: TargetVirtualMachineAction | 'delete';
  requestedAt: number;
  name: string;
};

const targetVMTransitionLabels: Record<TargetVMTransition['action'], string> = {
  start: '开机中',
  stop: '关机中',
  delete: '删除中',
};

function targetVMResourceKey(vm: InventoryVM) {
  return targetVMKey(inventoryVMNamespace(vm), vm.name);
}

export function VirtualMachinesPage({ view }: { view: 'source' | 'target' }) {
  const queryClient = useQueryClient();
  const providersQuery = useProviders();
  const plansQuery = usePlans();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [powerFilter, setPowerFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [targetNamespace, setTargetNamespace] = useState('all');
  const [targetGroup, setTargetGroup] = useState<'migrated' | 'inferred' | 'original' | 'all'>('migrated');
  const [selected, setSelected] = useState<string[]>([]);
  const [sourcePage, setSourcePage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [detailVM, setDetailVM] = useState<InventoryVM>();
  const [targetVMAction, setTargetVMAction] = useState<{ action: TargetVirtualMachineAction | 'delete'; vm: InventoryVM }>();
  const [targetVMTransitions, setTargetVMTransitions] = useState<Record<string, TargetVMTransition>>({});
  const [targetVMOperationNotice, setTargetVMOperationNotice] = useState<{ tone: 'success' | 'danger'; title: string; message: string }>();
  const providerItems = providersQuery.data?.items || [];
  const sourceProviders = providerItems.filter(isSourceProvider);
  const targetProviders = providerItems.filter(isEISTargetProvider);
  const requestedSource = searchParams.get('provider') || '';
  const requestedTarget = searchParams.get('target') || '';
  const sourceProvider = sourceProviders.find((item) => item.metadata.name === requestedSource) || sourceProviders[0];
  const targetProvider = targetProviders.find((item) => item.metadata.name === requestedTarget) || targetProviders[0];
  const sourceProviderType = sourceProvider?.spec.type;
  const sourceQuery = useInventoryVMs(sourceProvider);
  const targetQuery = useInventoryVMs(targetProvider, view === 'target');
  const manageTargetVM = useMutation({
    mutationFn: async ({ action, vm }: NonNullable<typeof targetVMAction>) => {
      const namespace = inventoryVMNamespace(vm);
      if (!namespace) throw new Error('目标虚拟机缺少资源空间信息，无法执行操作。');
      if (action === 'delete') return deleteTargetVirtualMachine(namespace, vm.name);
      return setTargetVirtualMachinePower(namespace, vm.name, action);
    },
    onMutate: (variables) => {
      const key = targetVMResourceKey(variables.vm);
      setTargetVMOperationNotice(undefined);
      setTargetVMTransitions((current) => ({
        ...current,
        [key]: { action: variables.action, requestedAt: Date.now(), name: variables.vm.name },
      }));
    },
    onError: (_error, variables) => {
      const key = targetVMResourceKey(variables.vm);
      setTargetVMTransitions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    onSuccess: async (_result, variables) => {
      if (variables.action === 'delete') setDetailVM(undefined);
      setTargetVMAction(undefined);
      await queryClient.invalidateQueries({ queryKey: ['inventory-vms', targetProvider?.metadata.uid] });
    },
  });
  const sourceVMs = useMemo(() => sourceQuery.data || [], [sourceQuery.data]);
  const targetVMs = useMemo(() => targetQuery.data || [], [targetQuery.data]);
  const currentDetailVM = detailVM
    ? targetVMs.find((vm) => targetVMResourceKey(vm) === targetVMResourceKey(detailVM)) || detailVM
    : undefined;
  const targetOrigins = migratedTargetVMs(plansQuery.data?.items || [], targetProvider?.metadata.name || '', targetVMs);
  const canManageTargetVMs = Boolean(targetProvider && isLocalEISTargetProvider(targetProvider));

  useEffect(() => {
    const entries = Object.entries(targetVMTransitions);
    if (entries.length === 0) return;
    const inventoryByKey = new Map(targetVMs.map((vm) => [targetVMResourceKey(vm), vm]));
    const settled: Array<[string, TargetVMTransition]> = [];
    entries.forEach(([key, transition]) => {
      const currentVM = inventoryByKey.get(key);
      const powerState = currentVM ? inventoryPowerState(currentVM) : undefined;
      const complete = transition.action === 'delete'
        ? !currentVM
        : transition.action === 'start'
          ? powerState === 'poweredOn'
          : powerState === 'poweredOff';
      if (complete) settled.push([key, transition]);
    });
    if (settled.length === 0) return;
    const timer = window.setTimeout(() => {
      setTargetVMTransitions((current) => {
        const next = { ...current };
        settled.forEach(([key]) => delete next[key]);
        return next;
      });
      const last = settled.at(-1)?.[1];
      if (last) setTargetVMOperationNotice({
        tone: 'success',
        title: `${last.name}${last.action === 'delete' ? '已删除' : last.action === 'start' ? '已启动' : '已关闭'}`,
        message: '目标集群已确认资源状态更新完成。',
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [targetQuery.dataUpdatedAt, targetVMTransitions, targetVMs]);

  useEffect(() => {
    if (Object.keys(targetVMTransitions).length === 0) return;
    const timer = window.setInterval(() => {
      targetQuery.refetch();
      const now = Date.now();
      const expired: TargetVMTransition[] = [];
      setTargetVMTransitions((current) => {
        const next = { ...current };
        Object.entries(current).forEach(([key, transition]) => {
          if (now - transition.requestedAt >= 120_000) {
            expired.push(transition);
            delete next[key];
          }
        });
        return next;
      });
      const last = expired.at(-1);
      if (last) setTargetVMOperationNotice({
        tone: 'danger',
        title: `${last.name} 状态确认超时`,
        message: `${targetVMTransitionLabels[last.action]}已等待超过 2 分钟，请刷新资源并确认目标集群状态后再操作。`,
      });
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [targetQuery, targetVMTransitions]);

  const filteredSourceVMs = sourceVMs.filter((vm) => {
    const matchesSearch = `${vm.name} ${vm.path || ''} ${vm.guestName || ''}`.toLowerCase().includes(search.toLowerCase());
    const powerState = inventoryPowerState(vm);
    const matchesPower = powerFilter === 'all' || (powerFilter === 'on' ? powerState === 'poweredOn' : powerState !== 'poweredOn');
    const toolsCompatible = hasVMwareToolsCompatibility(vm, sourceProviderType);
    const matchesRisk = riskFilter === 'all'
      || (riskFilter === 'critical' && hasConcern(vm, 'Critical') && !toolsCompatible)
      || (riskFilter === 'warning' && (hasMigrationWarning(vm) || toolsCompatible));
    return matchesSearch && matchesPower && matchesRisk;
  });
  const targetNamespaces = useMemo(() => Array.from(new Set(targetVMs.map(inventoryVMNamespace).filter(Boolean))).sort(), [targetVMs]);
  const filteredTargetVMs = useMemo(() => targetVMs.filter((vm) => {
    const namespace = inventoryVMNamespace(vm);
    const origin = targetOrigins.get(targetVMKey(namespace, vm.name));
    const group = origin?.confidence === 'confirmed' ? 'migrated' : origin ? 'inferred' : 'original';
    return `${vm.name} ${namespace} ${vm.guestName || ''}`.toLowerCase().includes(search.toLowerCase())
      && (targetNamespace === 'all' || namespace === targetNamespace)
      && (targetGroup === 'all' || targetGroup === group);
  }), [targetVMs, targetOrigins, search, targetNamespace, targetGroup]);

  const pageSize = 25;
  const sourcePageCount = Math.max(1, Math.ceil(filteredSourceVMs.length / pageSize));
  const currentSourcePage = Math.min(sourcePage, sourcePageCount);
  const pagedSourceVMs = filteredSourceVMs.slice((currentSourcePage - 1) * pageSize, currentSourcePage * pageSize);
  const targetPageCount = Math.max(1, Math.ceil(filteredTargetVMs.length / pageSize));
  const currentTargetPage = Math.min(targetPage, targetPageCount);
  const pagedTargetVMs = filteredTargetVMs.slice((currentTargetPage - 1) * pageSize, currentTargetPage * pageSize);
  const visibleIds = pagedSourceVMs.map((vm) => vm.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const activeProvider = view === 'source' ? sourceProvider : targetProvider;
  const activeQuery = view === 'source' ? sourceQuery : targetQuery;
  const ready = activeProvider?.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True');
  const poweredOn = (view === 'source' ? sourceVMs : targetVMs).filter((vm) => inventoryPowerState(vm) === 'poweredOn').length;
  const warnings = sourceVMs.filter((vm) => hasMigrationWarning(vm) || hasVMwareToolsCompatibility(vm, sourceProviderType)).length;
  const critical = sourceVMs.filter((vm) => hasConcern(vm, 'Critical') && !hasVMwareToolsCompatibility(vm, sourceProviderType)).length;
  const migratedCount = targetVMs.filter((vm) => targetOrigins.get(targetVMKey(inventoryVMNamespace(vm), vm.name))?.confidence === 'confirmed').length;
  const inferredCount = targetVMs.filter((vm) => targetOrigins.get(targetVMKey(inventoryVMNamespace(vm), vm.name))?.confidence === 'inferred').length;

  const switchSourceProvider = (name: string) => {
    setSearchParams({ provider: name });
    setSelected([]);
    setSourcePage(1);
  };
  const switchTargetProvider = (name: string) => {
    setSearchParams({ target: name });
    setTargetNamespace('all');
    setTargetGroup('migrated');
    setTargetPage(1);
  };

  return <>
    <div className="page-heading resource-heading">
      <div><h2>{view === 'source' ? '源端虚拟机' : '目标端虚拟机'}</h2><p>{view === 'source' ? '查看源端虚拟机，并将需要迁移的工作负载加入任务。' : '优先查看由迁移创建的虚拟机，也可切换查看目标集群原有资源。'}</p></div>
      <div className="page-actions">
        <Button variant="secondary" icon={<RefreshCw className={activeQuery.isFetching ? 'spin' : undefined} size={16} />} disabled={!activeProvider || activeQuery.isFetching} onClick={() => activeQuery.refetch()}>{activeQuery.isFetching ? '正在刷新' : '刷新资源'}</Button>
        {view === 'source' && sourceProvider && <Link className={`button button-primary ${selected.length === 0 ? 'is-disabled' : ''}`} aria-disabled={selected.length === 0} to={selected.length ? migrationLink(sourceProvider.metadata.name, selected) : '#'}><Zap size={16} />批量加入迁移任务</Link>}
      </div>
    </div>

    <section className="resource-context">
      <div className="resource-context-main">
        <div className="resource-context-icon">{view === 'source' ? <Server size={20} /> : <ShieldCheck size={20} />}</div>
        <div><span>{view === 'source' ? '当前源集群' : '当前目标集群'}</span><strong>{activeProvider?.metadata.name || `暂无可用${view === 'source' ? '源' : '目标'}集群`}</strong></div>
        {activeProvider && <StatusBadge tone={ready ? 'success' : 'danger'}>{ready ? '连接正常' : '连接异常'}</StatusBadge>}
      </div>
      <label className="provider-switch"><span>切换{view === 'source' ? '源' : '目标'}集群</span><Select value={activeProvider?.metadata.name || ''} onChange={(event) => view === 'source' ? switchSourceProvider(event.target.value) : switchTargetProvider(event.target.value)}>{(view === 'source' ? sourceProviders : targetProviders).map((item) => <option key={item.metadata.name} value={item.metadata.name}>{item.metadata.name}</option>)}</Select></label>
    </section>

    {view === 'source' ? <>
      <div className="metric-grid vm-metric-grid">
        <div className="metric metric-cyan"><div className="metric-header"><span>源虚拟机总数</span><Monitor size={18} /></div><div className="metric-value"><strong>{sourceVMs.length}</strong><span>台工作负载</span></div></div>
        <div className="metric metric-blue"><div className="metric-header"><span>正在运行</span><Zap size={18} /></div><div className="metric-value"><strong>{poweredOn}</strong><span>台已开机</span></div></div>
        <div className="metric metric-amber"><div className="metric-header"><span>迁移警告</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{warnings}</strong><span>台可迁移，建议确认</span></div></div>
        <div className="metric metric-red"><div className="metric-header"><span>迁移阻塞</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{critical}</strong><span>台需先处理</span></div></div>
      </div>

      <section className="panel table-panel vm-inventory-panel">
        <div className="vm-risk-guide"><span><StatusBadge tone="warning">迁移警告</StatusBadge>不会阻止创建任务，建议在迁移前确认提示内容。</span><span><StatusBadge tone="danger">迁移阻塞</StatusBadge>会阻止任务进入下一步，需要先处理或取消选择。</span></div>
        <div className="table-toolbar vm-toolbar">
          <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSourcePage(1); }} placeholder="搜索虚拟机、目录或操作系统" /></div>
          <div className="toolbar-filters">
            <Select className="input" aria-label="电源状态" value={powerFilter} onChange={(event) => { setPowerFilter(event.target.value); setSourcePage(1); }}><option value="all">全部电源状态</option><option value="on">运行中</option><option value="off">已关机</option></Select>
            <Select className="input" aria-label="迁移评估" value={riskFilter} onChange={(event) => { setRiskFilter(event.target.value); setSourcePage(1); }}><option value="all">全部评估结果</option><option value="warning">迁移警告</option><option value="critical">迁移阻塞</option></Select>
            <span className="selection-count">已选 {selected.length} 台</span>
          </div>
        </div>
        <PageState loading={providersQuery.isLoading || sourceQuery.isLoading} error={providersQuery.error || sourceQuery.error} empty={!sourceProvider || filteredSourceVMs.length === 0} emptyText={sourceProvider ? '没有符合条件的虚拟机' : '请先连接源集群'}>
          <table className="data-table vm-inventory-table">
            <thead><tr><th className="select-column"><input aria-label="选择当前页全部虚拟机" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected((current) => event.target.checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id)))} /></th><th>虚拟机</th><th>电源状态</th><th>操作系统</th><th>资源配置</th><th>所在目录</th><th>迁移评估</th><th aria-label="操作" /></tr></thead>
            <tbody>{pagedSourceVMs.map((vm) => {
              const toolsCompatible = hasVMwareToolsCompatibility(vm, sourceProviderType);
              const isCritical = hasConcern(vm, 'Critical') && !toolsCompatible;
              const concern = (isCritical ? vm.concerns?.find((item) => item.category.toLowerCase() === 'critical') : vm.concerns?.[0]);
              const concernSummary = (vm.concerns || []).map((item) => `${item.label || item.category}：${item.message || item.assessment || '请在创建任务时确认'}`).join('\n');
              const powerState = inventoryPowerState(vm);
              return <tr key={vm.id}>
                <td className="select-column"><input aria-label={`选择 ${vm.name}`} type="checkbox" checked={selected.includes(vm.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, vm.id] : current.filter((id) => id !== vm.id))} /></td>
                <td><span className="vm-name"><span className="vm-icon"><Monitor size={16} /></span><span><strong>{vm.name}</strong><small>{vm.id}</small></span></span></td>
                <td><StatusBadge tone={powerState === 'poweredOn' ? 'running' : 'pending'}>{powerState === 'poweredOn' ? '运行中' : '已关机'}</StatusBadge></td>
                <td>{vm.guestName || '-'}</td><td><ResourceSpec vm={vm} /></td>
                <td><span className="cell-subtitle vm-path">{vm.path || '-'}</span></td>
                <td>{isCritical ? <StatusBadge tone="danger">迁移阻塞</StatusBadge> : toolsCompatible ? <StatusBadge tone="warning">可跳过工具检查</StatusBadge> : concern ? <StatusBadge tone="warning">迁移警告</StatusBadge> : <StatusBadge tone="success">可迁移</StatusBadge>}{concern && <span className="cell-subtitle concern-summary" title={concernSummary}>{toolsCompatible ? '创建任务时可允许继续迁移' : concern.label || concern.category}{(vm.concerns?.length || 0) > 1 ? ` 等 ${vm.concerns?.length} 项` : ''}</span>}</td>
                <td><Link className="button button-secondary button-compact" to={migrationLink(sourceProvider!.metadata.name, [vm.id])}>创建迁移任务<ArrowRight size={14} /></Link></td>
              </tr>;
            })}</tbody>
          </table>
          <Pagination page={currentSourcePage} pageSize={pageSize} total={filteredSourceVMs.length} onPageChange={setSourcePage} />
          <div className="table-summary"><span><CheckCircle2 size={15} />显示 {filteredSourceVMs.length} / {sourceVMs.length} 台源虚拟机</span><span>资源数据来自 {sourceProvider?.metadata.name}</span></div>
        </PageState>
      </section>
    </> : <>
      <div className="metric-grid target-vm-metrics">
        <div className="metric metric-cyan"><div className="metric-header"><span>目标虚拟机总数</span><Monitor size={18} /></div><div className="metric-value"><strong>{targetVMs.length}</strong><span>台工作负载</span></div></div>
        <div className="metric metric-blue"><div className="metric-header"><span>正在运行</span><Zap size={18} /></div><div className="metric-value"><strong>{poweredOn}</strong><span>台已开机</span></div></div>
        <div className="metric"><div className="metric-header"><span>由迁移创建</span><History size={18} /></div><div className="metric-value"><strong>{migratedCount}</strong><span>台可追溯任务</span></div></div>
        <div className="metric metric-amber"><div className="metric-header"><span>目标集群原有</span><ShieldCheck size={18} /></div><div className="metric-value"><strong>{targetVMs.length - migratedCount - inferredCount}</strong><span>台无迁移记录</span></div></div>
      </div>

      <section className="panel table-panel vm-inventory-panel">
        {!canManageTargetVMs && targetProvider && <div className="target-vm-management-note"><Alert tone="info" title="远程目标集群为只读展示">开机、关机和删除操作仅支持本机目标集群；远程集群请在对应环境中操作。</Alert></div>}
        {targetVMOperationNotice && <div className="target-vm-management-note"><Alert tone={targetVMOperationNotice.tone} title={targetVMOperationNotice.title}>{targetVMOperationNotice.message}</Alert></div>}
        <div className="table-toolbar vm-toolbar">
          <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setTargetPage(1); }} placeholder="搜索虚拟机、资源空间或操作系统" /></div>
          <div className="toolbar-filters"><Select className="input" aria-label="虚拟机来源" value={targetGroup} onChange={(event) => { setTargetGroup(event.target.value as typeof targetGroup); setTargetPage(1); }}><option value="migrated">迁移创建（{migratedCount}）</option>{inferredCount > 0 && <option value="inferred">来源待确认（{inferredCount}）</option>}<option value="original">集群原有（{targetVMs.length - migratedCount - inferredCount}）</option><option value="all">全部来源（{targetVMs.length}）</option></Select><Select className="input" aria-label="目标资源空间" value={targetNamespace} onChange={(event) => { setTargetNamespace(event.target.value); setTargetPage(1); }}><option value="all">全部资源空间</option>{targetNamespaces.map((namespace) => <option key={namespace} value={namespace}>{namespace}</option>)}</Select></div>
        </div>
        <PageState
          loading={providersQuery.isLoading || targetQuery.isLoading}
          error={providersQuery.error || targetQuery.error}
          empty={!targetProvider || filteredTargetVMs.length === 0}
          emptyText={!targetProvider
            ? '未找到 EIS 目标集群'
            : targetVMs.length === 0
              ? '目标集群中暂未发现虚拟机'
              : targetGroup === 'migrated'
                ? '当前筛选下没有由迁移创建的目标虚拟机'
                : targetGroup === 'inferred'
                  ? '当前筛选下没有来源待确认的虚拟机'
                : targetGroup === 'original'
                  ? '当前筛选下没有目标集群原有虚拟机'
                  : '当前筛选下没有目标虚拟机'}
        >
          <table className="data-table target-vm-table">
            <thead><tr><th>虚拟机</th><th>资源空间</th><th>来源</th><th>电源状态</th><th>操作系统</th><th>资源配置</th><th>所属迁移任务</th><th aria-label="操作" /></tr></thead>
            <tbody>{pagedTargetVMs.map((vm) => {
              const namespace = inventoryVMNamespace(vm);
              const origin = targetOrigins.get(targetVMKey(namespace, vm.name));
              const powerState = inventoryPowerState(vm);
              const powerPresentation = inventoryPowerPresentation(vm);
              const transition = targetVMTransitions[targetVMResourceKey(vm)];
              return <tr key={`${namespace}/${vm.id}`}>
                <td><span className="vm-name"><span className="vm-icon"><Monitor size={16} /></span><span><strong>{vm.name}</strong><small>{vm.id}</small></span></span></td>
                <td><span className="namespace-label">{namespace || '-'}</span></td>
                <td>{origin?.confidence === 'confirmed' ? <StatusBadge tone="success">由迁移创建</StatusBadge> : origin ? <StatusBadge tone="warning">来源待确认</StatusBadge> : <StatusBadge tone="pending">目标集群原有</StatusBadge>}</td>
                <td><StatusBadge tone={transition ? 'running' : powerPresentation.tone}>{transition ? <><LoaderCircle className="spin" size={12} />{targetVMTransitionLabels[transition.action]}</> : <>{powerPresentation.transitional && <LoaderCircle className="spin" size={12} />}{powerPresentation.label}</>}</StatusBadge></td>
                <td>{vm.guestName || '-'}</td><td><ResourceSpec vm={vm} /></td>
                <td>{origin ? <><Link to={`/plans/${origin.planName}`}>{origin.planName}</Link><span className="cell-subtitle">{origin.confidence === 'confirmed' ? `来自 ${origin.sourceProvider}` : '名称和创建时间匹配，请人工确认'}</span></> : <span className="cell-subtitle">无迁移记录</span>}</td>
                <td><div className="target-vm-actions">
                  <Button variant="secondary" className="button-compact" icon={<Eye size={14} />} onClick={() => setDetailVM(vm)}>详情</Button>
                  {canManageTargetVMs && (transition
                    ? <Button variant="secondary" className="button-compact" icon={<LoaderCircle className="spin" size={14} />} disabled>{targetVMTransitionLabels[transition.action]}</Button>
                    : powerPresentation.transitional
                      ? <Button variant="secondary" className="button-compact" icon={<LoaderCircle className="spin" size={14} />} disabled>{powerPresentation.label}</Button>
                    : powerState === 'poweredOn'
                      ? <Button variant="secondary" className="button-compact" icon={<PowerOff size={14} />} onClick={() => { manageTargetVM.reset(); setTargetVMAction({ action: 'stop', vm }); }}>关机</Button>
                      : powerState === 'poweredOff'
                        ? <Button variant="secondary" className="button-compact" icon={<Power size={14} />} onClick={() => { manageTargetVM.reset(); setTargetVMAction({ action: 'start', vm }); }}>开机</Button>
                        : null)}
                  {canManageTargetVMs && <Button variant="ghost" className="button-compact target-vm-delete" icon={<Trash2 size={14} />} disabled={Boolean(transition) || powerPresentation.transitional} onClick={() => { manageTargetVM.reset(); setTargetVMAction({ action: 'delete', vm }); }}>删除</Button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          <Pagination page={currentTargetPage} pageSize={pageSize} total={filteredTargetVMs.length} onPageChange={setTargetPage} />
          <div className="table-summary"><span><CheckCircle2 size={15} />共 {filteredTargetVMs.length} 台{targetGroup === 'migrated' ? '迁移创建' : targetGroup === 'inferred' ? '来源待确认' : targetGroup === 'original' ? '集群原有' : '目标'}虚拟机</span><span>{targetNamespaces.length} 个资源空间</span></div>
        </PageState>
      </section>
    </>}
    <Modal title={currentDetailVM?.name || '虚拟机详情'} description="目标虚拟机的资源配置与迁移来源" open={Boolean(currentDetailVM)} onClose={() => setDetailVM(undefined)}
      footer={<>{currentDetailVM && canManageTargetVMs && (() => {
        const transition = targetVMTransitions[targetVMResourceKey(currentDetailVM)];
        if (transition) return <Button variant="secondary" icon={<LoaderCircle className="spin" size={15} />} disabled>{targetVMTransitionLabels[transition.action]}</Button>;
        const power = inventoryPowerPresentation(currentDetailVM);
        if (power.transitional) return <Button variant="secondary" icon={<LoaderCircle className="spin" size={15} />} disabled>{power.label}</Button>;
        return power.state === 'poweredOn'
          ? <Button variant="secondary" icon={<PowerOff size={15} />} onClick={() => { manageTargetVM.reset(); setTargetVMAction({ action: 'stop', vm: currentDetailVM }); }}>关闭虚拟机</Button>
          : power.state === 'poweredOff'
            ? <Button variant="secondary" icon={<Power size={15} />} onClick={() => { manageTargetVM.reset(); setTargetVMAction({ action: 'start', vm: currentDetailVM }); }}>启动虚拟机</Button>
            : null;
      })()}<Button variant="secondary" onClick={() => setDetailVM(undefined)}>关闭</Button></>}>
      {currentDetailVM && (() => {
        const namespace = inventoryVMNamespace(currentDetailVM);
        const origin = targetOrigins.get(targetVMKey(namespace, currentDetailVM.name));
        const networks = [
          ...(currentDetailVM.networks || []).map((item) => item.name || item.id || item.uid),
          ...(currentDetailVM.object?.spec?.template?.spec?.networks || []).map((item) => item.multus?.networkName || (item.pod ? '默认集群网络' : item.name)),
        ].filter(Boolean);
        const disks = configuredDisks(currentDetailVM);
        const power = inventoryPowerPresentation(currentDetailVM);
        return <div className="target-vm-detail">
          <div className="target-vm-detail-grid"><div><span>资源空间</span><strong>{namespace || '-'}</strong></div><div><span>电源状态</span><strong>{power.label}</strong></div><div><span>操作系统</span><strong>{currentDetailVM.guestName || '-'}</strong></div><div><span>处理器</span><strong>{inventoryCpuCount(currentDetailVM) || '-'} vCPU</strong></div><div><span>内存</span><strong>{formatMemory(inventoryMemoryMB(currentDetailVM))}</strong></div><div><span>配置磁盘</span><strong>{configuredDiskBytes(currentDetailVM) ? formatBytes(configuredDiskBytes(currentDetailVM)) : '容量读取中'} / {disks.length} 块</strong></div></div>
          <div className="target-vm-disk-section"><div className="target-vm-disk-heading"><HardDrive size={17} /><div><span>磁盘配置</span><strong>按虚拟机启动顺序区分系统盘与数据盘</strong></div></div>{disks.length ? <div className="target-vm-disk-list">{disks.map((disk, index) => { const capacity = configuredDiskCapacityBytes(disk); return <div key={`${disk.claimName || disk.name || 'disk'}-${index}`}><span className={`disk-role ${disk.role === 'system' ? 'system' : 'data'}`}>{disk.role === 'system' ? '系统盘' : '数据盘'}</span><strong>{capacity ? formatBytes(capacity) : '容量读取中'}</strong><small>{disk.claimName || disk.name || `磁盘 ${index + 1}`}{disk.storageClassName ? ` · ${disk.storageClassName}` : ''}</small></div>; })}</div> : <Alert tone="info" title="正在读取磁盘配置">虚拟机已创建，但关联的磁盘声明尚未出现在资源清单中。</Alert>}</div>
          <div className="target-vm-detail-section"><Network size={17} /><div><span>网络连接</span><strong>{networks.length ? networks.join('、') : '暂无可显示的网络信息'}</strong></div></div>
          <div className="target-vm-detail-section"><History size={17} /><div><span>迁移来源</span>{origin ? <><strong>{origin.confidence === 'confirmed' ? '由迁移任务创建' : '来源待确认'}</strong><Link to={`/plans/${origin.planName}`} onClick={() => setDetailVM(undefined)}>{origin.planName}</Link></> : <strong>目标集群原有资源</strong>}</div></div>
          {origin && <p className="target-vm-acceptance">建议在业务验收后确认网络连通、磁盘容量和应用启动状态。</p>}
        </div>;
      })()}
    </Modal>
    <ConfirmDialog
      open={Boolean(targetVMAction)}
      title={targetVMAction?.action === 'delete' ? '删除目标虚拟机' : targetVMAction?.action === 'stop' ? '关闭目标虚拟机' : '启动目标虚拟机'}
      description={targetVMAction?.action === 'delete'
        ? `将删除目标资源空间 ${inventoryVMNamespace(targetVMAction.vm)} 中的虚拟机 ${targetVMAction.vm.name}。控制台不会额外发起磁盘清理，但目标平台可能按资源关联策略处理其数据，请先确认备份。`
        : targetVMAction?.action === 'stop'
          ? `将关闭虚拟机 ${targetVMAction.vm.name}，其上运行的业务会立即停止。`
          : `将启动虚拟机 ${targetVMAction?.vm.name || ''}。`}
      confirmLabel={targetVMAction?.action === 'delete' ? '确认删除' : targetVMAction?.action === 'stop' ? '确认关机' : '确认开机'}
      danger={targetVMAction?.action !== 'start'}
      pending={manageTargetVM.isPending}
      pendingLabel={targetVMAction?.action === 'delete' ? '正在提交删除...' : targetVMAction?.action === 'stop' ? '正在提交关机...' : '正在提交开机...'}
      error={manageTargetVM.error}
      onClose={() => !manageTargetVM.isPending && setTargetVMAction(undefined)}
      onConfirm={() => targetVMAction && manageTargetVM.mutate(targetVMAction)}
    />
  </>;
}
