import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Cpu, HardDrive, History, Monitor,
  RefreshCw, Search, Server, ShieldCheck, Zap,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInventoryVMs, usePlans, useProviders } from '../api/hooks';
import { formatBytes } from '../domain/format';
import {
  configuredDiskBytes,
  inventoryCpuCount,
  inventoryMemoryMB,
  inventoryPowerState,
  inventoryVMNamespace,
  migratedTargetVMs,
  targetVMKey,
} from '../domain/inventory';
import { isEISTargetProvider, isSourceProvider } from '../domain/providers';
import type { InventoryVM } from '../domain/types';
import { Button, PageState, Select, StatusBadge } from '../components/ui';

function hasConcern(vm: InventoryVM, category: string) {
  return vm.concerns?.some((concern) => concern.category.toLowerCase() === category.toLowerCase());
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
  return <span className="resource-spec">
    <span><Cpu size={13} />{inventoryCpuCount(vm) || '-'} vCPU</span>
    <span>{formatMemory(inventoryMemoryMB(vm))}</span>
    <span title="虚拟机配置的磁盘总容量"><HardDrive size={13} />{diskBytes ? formatBytes(diskBytes) : '-'}</span>
  </span>;
}

export function VirtualMachinesPage({ view }: { view: 'source' | 'target' }) {
  const providersQuery = useProviders();
  const plansQuery = usePlans();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [powerFilter, setPowerFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [targetNamespace, setTargetNamespace] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const providerItems = providersQuery.data?.items || [];
  const sourceProviders = providerItems.filter(isSourceProvider);
  const targetProviders = providerItems.filter(isEISTargetProvider);
  const requestedSource = searchParams.get('provider') || '';
  const requestedTarget = searchParams.get('target') || '';
  const sourceProvider = sourceProviders.find((item) => item.metadata.name === requestedSource) || sourceProviders[0];
  const targetProvider = targetProviders.find((item) => item.metadata.name === requestedTarget) || targetProviders[0];
  const sourceQuery = useInventoryVMs(sourceProvider);
  const targetQuery = useInventoryVMs(targetProvider);
  const sourceVMs = useMemo(() => sourceQuery.data || [], [sourceQuery.data]);
  const targetVMs = useMemo(() => targetQuery.data || [], [targetQuery.data]);
  const targetOrigins = migratedTargetVMs(plansQuery.data?.items || [], targetProvider?.metadata.name || '');

  const filteredSourceVMs = useMemo(() => sourceVMs.filter((vm) => {
    const matchesSearch = `${vm.name} ${vm.path || ''} ${vm.guestName || ''}`.toLowerCase().includes(search.toLowerCase());
    const powerState = inventoryPowerState(vm);
    const matchesPower = powerFilter === 'all' || (powerFilter === 'on' ? powerState === 'poweredOn' : powerState !== 'poweredOn');
    const matchesRisk = riskFilter === 'all'
      || (riskFilter === 'critical' && hasConcern(vm, 'Critical'))
      || (riskFilter === 'attention' && Boolean(vm.concerns?.length));
    return matchesSearch && matchesPower && matchesRisk;
  }), [sourceVMs, search, powerFilter, riskFilter]);
  const targetNamespaces = useMemo(() => Array.from(new Set(targetVMs.map(inventoryVMNamespace).filter(Boolean))).sort(), [targetVMs]);
  const filteredTargetVMs = useMemo(() => targetVMs.filter((vm) => {
    const namespace = inventoryVMNamespace(vm);
    return `${vm.name} ${namespace} ${vm.guestName || ''}`.toLowerCase().includes(search.toLowerCase())
      && (targetNamespace === 'all' || namespace === targetNamespace);
  }), [targetVMs, search, targetNamespace]);

  const visibleIds = filteredSourceVMs.map((vm) => vm.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const activeProvider = view === 'source' ? sourceProvider : targetProvider;
  const activeQuery = view === 'source' ? sourceQuery : targetQuery;
  const ready = activeProvider?.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True');
  const poweredOn = (view === 'source' ? sourceVMs : targetVMs).filter((vm) => inventoryPowerState(vm) === 'poweredOn').length;
  const attention = sourceVMs.filter((vm) => vm.concerns?.length).length;
  const critical = sourceVMs.filter((vm) => hasConcern(vm, 'Critical')).length;
  const migratedCount = targetVMs.filter((vm) => targetOrigins.has(targetVMKey(inventoryVMNamespace(vm), vm.name))).length;

  const switchSourceProvider = (name: string) => {
    setSearchParams({ provider: name });
    setSelected([]);
  };
  const switchTargetProvider = (name: string) => setSearchParams({ target: name });

  return <>
    <div className="page-heading resource-heading">
      <div><span className="eyebrow">虚拟机资源</span><h2>{view === 'source' ? '源集群虚拟机' : '目标集群虚拟机'}</h2><p>{view === 'source' ? '选择需要迁移的虚拟机，并直接创建迁移计划。' : '查看 EIS 目标集群中已有的虚拟机及其来源。'}</p></div>
      <div className="page-actions">
        <Button variant="secondary" icon={<RefreshCw className={activeQuery.isFetching ? 'spin' : undefined} size={16} />} disabled={!activeProvider || activeQuery.isFetching} onClick={() => activeQuery.refetch()}>{activeQuery.isFetching ? '正在刷新' : '刷新资源'}</Button>
        {view === 'source' && sourceProvider && <Link className={`button button-primary ${selected.length === 0 ? 'is-disabled' : ''}`} aria-disabled={selected.length === 0} to={selected.length ? migrationLink(sourceProvider.metadata.name, selected) : '#'}><Zap size={16} />迁移所选虚拟机</Link>}
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
        <div className="metric metric-amber"><div className="metric-header"><span>需要关注</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{attention}</strong><span>台存在提示</span></div></div>
        <div className="metric metric-red"><div className="metric-header"><span>迁移阻塞</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{critical}</strong><span>台需先处理</span></div></div>
      </div>

      <section className="panel table-panel vm-inventory-panel">
        <div className="table-toolbar vm-toolbar">
          <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索虚拟机、目录或操作系统" /></div>
          <div className="toolbar-filters">
            <Select className="input" aria-label="电源状态" value={powerFilter} onChange={(event) => setPowerFilter(event.target.value)}><option value="all">全部电源状态</option><option value="on">运行中</option><option value="off">已关机</option></Select>
            <Select className="input" aria-label="迁移评估" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="all">全部评估结果</option><option value="attention">需要关注</option><option value="critical">迁移阻塞</option></Select>
            <span className="selection-count">已选 {selected.length} 台</span>
          </div>
        </div>
        <PageState loading={providersQuery.isLoading || sourceQuery.isLoading} error={providersQuery.error || sourceQuery.error} empty={!sourceProvider || filteredSourceVMs.length === 0} emptyText={sourceProvider ? '没有符合条件的虚拟机' : '请先连接源集群'}>
          <table className="data-table vm-inventory-table">
            <thead><tr><th className="select-column"><input aria-label="选择当前页全部虚拟机" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected((current) => event.target.checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id)))} /></th><th>虚拟机</th><th>电源状态</th><th>操作系统</th><th>资源配置</th><th>所在目录</th><th>迁移评估</th><th aria-label="操作" /></tr></thead>
            <tbody>{filteredSourceVMs.map((vm) => {
              const isCritical = hasConcern(vm, 'Critical');
              const concern = vm.concerns?.[0];
              const powerState = inventoryPowerState(vm);
              return <tr key={vm.id}>
                <td className="select-column"><input aria-label={`选择 ${vm.name}`} type="checkbox" checked={selected.includes(vm.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, vm.id] : current.filter((id) => id !== vm.id))} /></td>
                <td><span className="vm-name"><span className="vm-icon"><Monitor size={16} /></span><span><strong>{vm.name}</strong><small>{vm.id}</small></span></span></td>
                <td><StatusBadge tone={powerState === 'poweredOn' ? 'running' : 'pending'}>{powerState === 'poweredOn' ? '运行中' : '已关机'}</StatusBadge></td>
                <td>{vm.guestName || '-'}</td><td><ResourceSpec vm={vm} /></td>
                <td><span className="cell-subtitle vm-path">{vm.path || '-'}</span></td>
                <td>{isCritical ? <StatusBadge tone="danger">迁移阻塞</StatusBadge> : concern ? <StatusBadge tone="warning">需要关注</StatusBadge> : <StatusBadge tone="success">可迁移</StatusBadge>}{concern && <span className="cell-subtitle" title={concern.message || concern.assessment}>{concern.label || concern.category}</span>}</td>
                <td><Link className="button button-secondary button-compact" to={migrationLink(sourceProvider!.metadata.name, [vm.id])}>迁移<ArrowRight size={14} /></Link></td>
              </tr>;
            })}</tbody>
          </table>
          <div className="table-summary"><span><CheckCircle2 size={15} />显示 {filteredSourceVMs.length} / {sourceVMs.length} 台源虚拟机</span><span>资源数据来自 {sourceProvider?.metadata.name}</span></div>
        </PageState>
      </section>
    </> : <>
      <div className="metric-grid target-vm-metrics">
        <div className="metric metric-cyan"><div className="metric-header"><span>目标虚拟机总数</span><Monitor size={18} /></div><div className="metric-value"><strong>{targetVMs.length}</strong><span>台工作负载</span></div></div>
        <div className="metric metric-blue"><div className="metric-header"><span>正在运行</span><Zap size={18} /></div><div className="metric-value"><strong>{poweredOn}</strong><span>台已开机</span></div></div>
        <div className="metric"><div className="metric-header"><span>由迁移创建</span><History size={18} /></div><div className="metric-value"><strong>{migratedCount}</strong><span>台可追溯计划</span></div></div>
        <div className="metric metric-amber"><div className="metric-header"><span>目标集群原有</span><ShieldCheck size={18} /></div><div className="metric-value"><strong>{targetVMs.length - migratedCount}</strong><span>台非本平台迁入</span></div></div>
      </div>

      <section className="panel table-panel vm-inventory-panel">
        <div className="table-toolbar vm-toolbar">
          <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索虚拟机、命名空间或操作系统" /></div>
          <div className="toolbar-filters"><Select className="input" aria-label="目标命名空间" value={targetNamespace} onChange={(event) => setTargetNamespace(event.target.value)}><option value="all">全部命名空间</option>{targetNamespaces.map((namespace) => <option key={namespace} value={namespace}>{namespace}</option>)}</Select></div>
        </div>
        <PageState
          loading={providersQuery.isLoading || targetQuery.isLoading}
          error={providersQuery.error || targetQuery.error}
          empty={!targetProvider || filteredTargetVMs.length === 0}
          emptyText={!targetProvider
            ? '未找到 EIS 目标集群'
            : targetVMs.length === 0
              ? '目标集群中暂未发现虚拟机'
              : '当前搜索或命名空间筛选没有匹配的虚拟机'}
        >
          <table className="data-table target-vm-table">
            <thead><tr><th>虚拟机</th><th>命名空间</th><th>来源</th><th>电源状态</th><th>操作系统</th><th>资源配置</th><th>关联迁移</th></tr></thead>
            <tbody>{filteredTargetVMs.map((vm) => {
              const namespace = inventoryVMNamespace(vm);
              const origin = targetOrigins.get(targetVMKey(namespace, vm.name));
              const powerState = inventoryPowerState(vm);
              return <tr key={`${namespace}/${vm.id}`}>
                <td><span className="vm-name"><span className="vm-icon"><Monitor size={16} /></span><span><strong>{vm.name}</strong><small>{vm.id}</small></span></span></td>
                <td><span className="namespace-label">{namespace || '-'}</span></td>
                <td>{origin ? <StatusBadge tone="success">由迁移创建</StatusBadge> : <StatusBadge tone="pending">目标集群原有</StatusBadge>}</td>
                <td><StatusBadge tone={powerState === 'poweredOn' ? 'running' : 'pending'}>{powerState === 'poweredOn' ? '运行中' : '已关机'}</StatusBadge></td>
                <td>{vm.guestName || '-'}</td><td><ResourceSpec vm={vm} /></td>
                <td>{origin ? <><Link to={`/plans/${origin.planName}`}>{origin.planName}</Link><span className="cell-subtitle">来自 {origin.sourceProvider}</span></> : <span className="cell-subtitle">无迁移记录</span>}</td>
              </tr>;
            })}</tbody>
          </table>
          <div className="table-summary"><span><CheckCircle2 size={15} />显示 {filteredTargetVMs.length} / {targetVMs.length} 台目标虚拟机</span><span>{targetNamespaces.length} 个命名空间</span></div>
        </PageState>
      </section>
    </>}
  </>;
}
