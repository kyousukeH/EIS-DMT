import { useMemo, useRef, useState } from 'react';
import { ArrowRight, HardDrive, Info, Network, Pencil, Plus, Search, Server, Trash2, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  useCreateResource,
  useDeleteResource,
  useInventoryNetworks,
  useInventoryStorages,
  useInventoryVMs,
  useNetworkMaps,
  usePatchResource,
  usePlans,
  useProviders,
  useStorageMaps,
} from '../api/hooks';
import { getRuntimeConfig } from '../api/client';
import { buildNetworkMap, buildStorageMap } from '../domain/builders';
import { inventoryResourceKey, vmsUsingResource } from '../domain/inventory';
import { getPlanStatus } from '../domain/status';
import { isEISTargetProvider, isSourceProvider } from '../domain/providers';
import type { InventoryResource, NetworkMap, Provider, StorageMap } from '../domain/types';
import { Alert, Button, ConfirmDialog, Field, IconButton, Modal, PageState, Pagination, Select, StatusBadge, formatDate } from '../components/ui';

type Tab = 'network' | 'storage';
type VolumeMode = StorageMap['spec']['map'][number]['destination']['volumeMode'];
type AccessMode = StorageMap['spec']['map'][number]['destination']['accessMode'];
type NetworkIPMode = NonNullable<NetworkMap['spec']['map'][number]['networkIPMode']>;

interface MappingRow {
  key: number;
  sourceId: string;
  sourceName?: string;
  sourceNamespace?: string;
  sourceType?: string;
  manualSource: boolean;
  targetResource: string;
  targetNamespace?: string;
  manualTarget: boolean;
  volumeMode: VolumeMode;
  accessMode: AccessMode;
  networkIPMode: NetworkIPMode;
}

const defaultNetworkValue = '__default_network__';
const manualValue = '__manual__';
const resourceNamePattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

function compliantName(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
}

export function MappingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const providers = useProviders();
  const networkMaps = useNetworkMaps();
  const storageMaps = useStorageMaps();
  const plans = usePlans();
  const createNetwork = useCreateResource<NetworkMap>('networkmaps');
  const createStorage = useCreateResource<StorageMap>('storagemaps');
  const patchNetwork = usePatchResource<NetworkMap>('networkmaps');
  const patchStorage = usePatchResource<StorageMap>('storagemaps');
  const deleteNetwork = useDeleteResource('networkmaps');
  const deleteStorage = useDeleteResource('storagemaps');
  const tab: Tab = searchParams.get('tab') === 'storage' ? 'storage' : 'network';
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NetworkMap | StorageMap>();
  const [name, setName] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [destinationName, setDestinationName] = useState('host');
  const [deleteTarget, setDeleteTarget] = useState<NetworkMap | StorageMap>();
  const [page, setPage] = useState(1);
  const config = getRuntimeConfig();
  const nextRowKey = useRef(1);

  const emptyRow = (key = 0, nextTab = tab): MappingRow => ({
    key,
    sourceId: '',
    manualSource: false,
    targetResource: nextTab === 'storage' ? config.defaultStorageClass : '',
    manualTarget: false,
    volumeMode: config.defaultVolumeMode,
    accessMode: config.defaultAccessMode,
    networkIPMode: 'preserve',
  });
  const [rows, setRows] = useState<MappingRow[]>(() => [emptyRow()]);

  const providerItems = providers.data?.items || [];
  const sourceProviders = providerItems.filter(isSourceProvider);
  const destinations = providerItems.filter(isEISTargetProvider);
  const findProvider = (value: string) => providerItems.find((provider) => provider.metadata.name === value) as Provider | undefined;
  const source = findProvider(sourceName);
  const destination = findProvider(destinationName);
  const sourceVMs = useInventoryVMs(source);
  const sourceNetworks = useInventoryNetworks(source, 'source');
  const sourceStorages = useInventoryStorages(source, 'source');
  const targetNetworks = useInventoryNetworks(destination, 'target');
  const targetStorages = useInventoryStorages(destination, 'target');
  const sourceResources = tab === 'storage' ? sourceStorages.data || [] : sourceNetworks.data || [];
  const targetResources = tab === 'storage' ? targetStorages.data || [] : targetNetworks.data || [];

  const { filtered, managedCount } = useMemo(() => {
    const maps = tab === 'network' ? networkMaps.data?.items || [] : storageMaps.data?.items || [];
    const publicMaps = maps.filter((mapping) => !mapping.metadata.labels?.['eis-dmt.io/managed-for-task']);
    return {
      filtered: publicMaps.filter((mapping) => mapping.metadata.name.toLowerCase().includes(search.toLowerCase())),
      managedCount: maps.length - publicMaps.length,
    };
  }, [tab, networkMaps.data, storageMaps.data, search]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedMappings = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const reset = (nextTab = tab) => {
    setEditing(undefined);
    setName('');
    setSourceName('');
    setDestinationName('host');
    nextRowKey.current = 1;
    setRows([emptyRow(0, nextTab)]);
  };
  const selectTab = (nextTab: Tab) => {
    setSearchParams({ tab: nextTab }, { replace: true });
    setPage(1);
    reset(nextTab);
  };
  const close = () => { setOpen(false); reset(); };
  const openCreate = () => {
    reset(tab);
    setSourceName(sourceProviders[0]?.metadata.name || '');
    setDestinationName(destinations.find((provider) => provider.metadata.name === 'host')?.metadata.name || destinations[0]?.metadata.name || '');
    setOpen(true);
  };
  const openEdit = (mapping: NetworkMap | StorageMap) => {
    const mappingTab: Tab = mapping.kind === 'StorageMap' ? 'storage' : 'network';
    setEditing(mapping);
    setName(mapping.metadata.name);
    setSourceName(mapping.spec.provider.source.name);
    setDestinationName(mapping.spec.provider.destination.name);
    if (mapping.kind === 'StorageMap') {
      setRows(mapping.spec.map.map((item, index) => ({
        key: index,
        sourceId: item.source.id || '',
        sourceName: item.source.name,
        sourceNamespace: item.source.namespace,
        sourceType: item.source.type,
        manualSource: false,
        targetResource: item.destination.storageClass,
        manualTarget: false,
        volumeMode: item.destination.volumeMode || config.defaultVolumeMode,
        accessMode: item.destination.accessMode || config.defaultAccessMode,
        networkIPMode: 'preserve',
      })));
    } else {
      setRows(mapping.spec.map.map((item, index) => ({
        key: index,
        sourceId: item.source.id || '',
        sourceName: item.source.name,
        sourceNamespace: item.source.namespace,
        sourceType: item.source.type,
        manualSource: false,
        targetResource: item.destination.type === 'multus' ? item.destination.name || '' : '',
        targetNamespace: item.destination.namespace,
        manualTarget: false,
        volumeMode: config.defaultVolumeMode,
        accessMode: config.defaultAccessMode,
        networkIPMode: item.networkIPMode || 'preserve',
      })));
    }
    nextRowKey.current = mapping.spec.map.length;
    setSearchParams({ tab: mappingTab }, { replace: true });
    setOpen(true);
  };
  const updateRow = (key: number, patch: Partial<MappingRow>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  };
  const resetRowsForSource = (value: string) => {
    setSourceName(value);
    nextRowKey.current = 1;
    setRows([emptyRow(0)]);
  };
  const addRow = () => {
    const key = nextRowKey.current;
    nextRowKey.current += 1;
    setRows((current) => [...current, emptyRow(key)]);
  };
  const removeRow = (key: number) => setRows((current) => current.filter((row) => row.key !== key));

  const sourceSelectionValue = (row: MappingRow) => {
    if (row.manualSource) return manualValue;
    if (source?.spec.type === 'openshift') {
      if (row.sourceType === 'pod') return 'pod';
      return row.sourceNamespace && row.sourceName ? `${row.sourceNamespace}/${row.sourceName}` : row.sourceName || '';
    }
    return row.sourceId || row.sourceName || '';
  };
  const targetSelectionValue = (row: MappingRow) => {
    if (row.manualTarget) return manualValue;
    if (tab === 'storage') return row.targetResource;
    return row.targetResource ? `${row.targetNamespace || config.namespace}/${row.targetResource}` : defaultNetworkValue;
  };
  const selectSourceResource = (row: MappingRow, value: string) => {
    if (value === manualValue) {
      updateRow(row.key, { manualSource: true, sourceId: '', sourceName: '', sourceNamespace: undefined, sourceType: undefined });
      return;
    }
    const resource = sourceResources.find((item) => source && inventoryResourceKey(item, source.spec.type) === value);
    if (!resource || !source) return;
    const kubeVirtSource = source.spec.type === 'openshift';
    updateRow(row.key, {
      manualSource: false,
      sourceId: kubeVirtSource ? '' : resource.id || resource.uid || '',
      sourceName: resource.type === 'pod' ? undefined : resource.name,
      sourceNamespace: kubeVirtSource ? resource.namespace : undefined,
      sourceType: resource.type === 'pod' ? 'pod' : undefined,
    });
  };
  const selectTargetResource = (row: MappingRow, value: string) => {
    if (value === manualValue) {
      updateRow(row.key, { manualTarget: true, targetResource: '', targetNamespace: undefined });
      return;
    }
    if (tab === 'network' && value === defaultNetworkValue) {
      updateRow(row.key, { manualTarget: false, targetResource: '', targetNamespace: undefined });
      return;
    }
    const resource = targetResources.find((item) => destination && inventoryResourceKey(item, destination.spec.type) === value);
    if (!resource) return;
    updateRow(row.key, { manualTarget: false, targetResource: resource.name, targetNamespace: resource.namespace });
  };

  const save = () => {
    if (!source || !destination) return;
    if (tab === 'storage') {
      const body = buildStorageMap({
        name, namespace: config.namespace, source, destination,
        pairs: rows.map((row) => ({
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          sourceNamespace: row.sourceNamespace,
          sourceType: row.sourceType,
          storageClass: row.targetResource,
          volumeMode: row.volumeMode,
          accessMode: row.accessMode,
        })),
      });
      if (editing) patchStorage.mutate({ name: editing.metadata.name, patch: { spec: body.spec } }, { onSuccess: close });
      else createStorage.mutate(body, { onSuccess: close });
      return;
    }
    const body = buildNetworkMap({
      name, namespace: config.namespace, source, destination,
      pairs: rows.map((row) => ({
        source: {
          ...(row.sourceId ? { id: row.sourceId } : {}),
          ...(row.sourceName ? { name: row.sourceName } : {}),
          ...(row.sourceNamespace ? { namespace: row.sourceNamespace } : {}),
          ...(row.sourceType ? { type: row.sourceType } : {}),
        },
        destination: row.targetResource
          ? { type: 'multus' as const, name: row.targetResource, namespace: row.targetNamespace || config.namespace }
          : { type: 'pod' as const },
        networkIPMode: row.networkIPMode,
      })),
    });
    if (editing) patchNetwork.mutate({ name: editing.metadata.name, patch: { spec: body.spec } }, { onSuccess: close });
    else createNetwork.mutate(body, { onSuccess: close });
  };

  const activePending = createNetwork.isPending || createStorage.isPending || patchNetwork.isPending || patchStorage.isPending;
  const activeError = createNetwork.error || createStorage.error || patchNetwork.error || patchStorage.error;
  const inventoryError = sourceVMs.error || (tab === 'storage' ? sourceStorages.error || targetStorages.error : sourceNetworks.error || targetNetworks.error);
  const inventoryLoading = sourceVMs.isLoading || (tab === 'storage' ? sourceStorages.isLoading || targetStorages.isLoading : sourceNetworks.isLoading || targetNetworks.isLoading);
  const sourceKeys = rows.map((row) => [row.sourceNamespace, row.sourceId || row.sourceName || row.sourceType].filter(Boolean).join('/')).filter(Boolean);
  const duplicateSources = new Set(sourceKeys).size !== sourceKeys.length;
  const rowsValid = rows.length > 0 && !duplicateSources && rows.every((row) =>
    Boolean(row.sourceId || row.sourceName || row.sourceType) && (tab !== 'storage' || row.targetResource));
  const existingNames = (tab === 'network' ? networkMaps.data?.items || [] : storageMaps.data?.items || []).map((item) => item.metadata.name);
  const duplicateName = !editing && existingNames.includes(name);
  const nameError = !name ? '' : name.length > 63 ? '名称最多 63 个字符。' : !resourceNamePattern.test(name)
    ? '名称只能包含小写字母、数字和连字符，并且必须以字母或数字开头和结尾。'
    : duplicateName ? '该名称已存在，请使用其他名称。' : '';

  const referencingPlans = (mapping: NetworkMap | StorageMap) => (plans.data?.items || []).filter((plan) =>
    (mapping.kind === 'StorageMap' ? plan.spec.map.storage.name : plan.spec.map.network.name) === mapping.metadata.name);
  const lockedPlans = (mapping: NetworkMap | StorageMap) => referencingPlans(mapping).filter((plan) => {
    const tone = getPlanStatus(plan).tone;
    return !plan.spec.archived && !['success', 'danger'].includes(tone);
  });

  const usageFor = (resource?: InventoryResource) => resource && source
    ? vmsUsingResource(sourceVMs.data || [], resource, tab, source.spec.type)
    : [];

  return <>
    <div className="page-heading"><div><h2>网络与存储映射</h2><p>把源端正在使用的网络和存储，对应到虚拟机迁移后要使用的位置。</p></div><Button icon={<Plus size={16} />} onClick={openCreate}>创建{tab === 'network' ? '网络' : '存储'}映射</Button></div>

    <section className="mapping-explainer" aria-labelledby="mapping-explainer-title">
      <div className="mapping-explainer-heading"><span><Info size={18} /></span><div><h3 id="mapping-explainer-title">迁移前为什么要配置网络和存储？</h3><p>源集群和 EIS 目标集群使用的资源名称通常不同。提前确认对应关系，虚拟机迁移后才能连接正确的业务网络并找到合适的磁盘位置。</p></div></div>
      <div className="mapping-flow" aria-label="源集群资源到 EIS 目标资源的对应流程">
        <div className="mapping-flow-end"><span><Server size={24} /></span><div><small>虚拟机当前使用</small><strong>源集群资源</strong></div></div>
        <div className="mapping-flow-connector"><span /><b>建立对应关系</b><ArrowRight size={20} /></div>
        <div className="mapping-flow-end target"><span><Server size={24} /></span><div><small>虚拟机迁移后使用</small><strong>EIS 目标资源</strong></div></div>
      </div>
      <div className="mapping-explainer-details">
        <button aria-label="查看网络说明" className={tab === 'network' ? 'active' : ''} onClick={() => selectTab('network')}>
          <span className="mapping-detail-icon network"><Network size={21} /></span><span><strong>网络配置</strong><small>决定虚拟机迁移后接入哪个业务网络，以及 IP 地址如何处理。</small></span><ArrowRight size={17} />
        </button>
        <button aria-label="查看存储说明" className={tab === 'storage' ? 'active' : ''} onClick={() => selectTab('storage')}>
          <span className="mapping-detail-icon storage"><HardDrive size={21} /></span><span><strong>存储配置</strong><small>决定每块源磁盘迁移到哪个存储位置，以及磁盘的使用方式。</small></span><ArrowRight size={17} />
        </button>
      </div>
    </section>

    <div className="tabs"><button className={tab === 'network' ? 'active' : ''} onClick={() => selectTab('network')}><Network size={15} />网络配置</button><button className={tab === 'storage' ? 'active' : ''} onClick={() => selectTab('storage')}><HardDrive size={15} />存储配置</button></div>
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索配置名称" /></div><span className="cell-subtitle">共 {filtered.length} 个公共配置{managedCount > 0 ? `，另有 ${managedCount} 个任务专用配置` : ''}</span></div>
      <PageState loading={networkMaps.isLoading || storageMaps.isLoading} error={networkMaps.error || storageMaps.error} empty={filtered.length === 0} emptyText="暂无配置">
        <table className="data-table"><thead><tr><th>名称</th><th>来源与目标</th><th>配置条目</th><th>{tab === 'storage' ? '目标存储' : '目标网络'}</th><th>使用情况</th><th>状态</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
          <tbody>{pagedMappings.map((mapping) => {
            const ready = mapping.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True');
            const storage = mapping.kind === 'StorageMap' ? mapping as StorageMap : undefined;
            const network = mapping.kind === 'NetworkMap' ? mapping as NetworkMap : undefined;
            const references = referencingPlans(mapping);
            const locks = lockedPlans(mapping);
            const targetSummaries = storage
              ? storage.spec.map.map((item) => `${item.destination.storageClass || '/'} · ${item.destination.volumeMode === 'Block' ? '块设备' : item.destination.volumeMode === 'Filesystem' ? '文件系统' : '/'} · ${item.destination.accessMode === 'ReadWriteMany' ? '多节点读写' : item.destination.accessMode === 'ReadWriteOnce' ? '单节点读写' : item.destination.accessMode === 'ReadOnlyMany' ? '多节点只读' : '/'}`)
              : network?.spec.map.map((item) => item.destination.type === 'multus'
                ? `附加业务网络 · ${item.destination.namespace || '/'} / ${item.destination.name || '/'}`
                : item.destination.type === 'ignored' ? '不连接目标网络' : '默认集群网络') || [];
            const uniqueTargets = Array.from(new Set(targetSummaries));
            return <tr key={mapping.metadata.name}>
              <td><span className="cell-title">{mapping.metadata.name}</span></td>
              <td>{mapping.spec.provider.source.name} → {mapping.spec.provider.destination.name}</td>
              <td>{mapping.spec.map.length}</td>
              <td><span className="cell-title">{uniqueTargets[0] || '/'}</span>{uniqueTargets.length > 1 && <span className="cell-subtitle" title={uniqueTargets.join('\n')}>另有 {uniqueTargets.length - 1} 种目标配置</span>}</td>
              <td>{references.length ? <><span className="cell-title">{references.length} 个迁移任务</span><span className="cell-subtitle" title={references.map((plan) => plan.metadata.name).join('\n')}>{locks.length ? `${locks.length} 个任务尚未结束` : '均已结束'}</span></> : <span className="cell-subtitle">尚未使用</span>}</td>
              <td><StatusBadge tone={ready ? 'success' : 'pending'}>{ready ? '就绪' : '校验中'}</StatusBadge></td><td>{formatDate(mapping.metadata.creationTimestamp)}</td>
              <td><div className="page-actions"><IconButton label={`编辑 ${mapping.metadata.name}`} title={locks.length ? `被未完成任务使用：${locks.map((plan) => plan.metadata.name).join('、')}` : '编辑配置'} disabled={locks.length > 0} onClick={() => openEdit(mapping)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${mapping.metadata.name}`} title={locks.length ? `被未完成任务使用：${locks.map((plan) => plan.metadata.name).join('、')}` : '删除配置'} disabled={locks.length > 0} onClick={() => { (mapping.kind === 'StorageMap' ? deleteStorage : deleteNetwork).reset(); setDeleteTarget(mapping); }}><Trash2 size={16} /></IconButton></div></td>
            </tr>;
          })}</tbody>
        </table>
        <Pagination page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
      </PageState>
    </section>

    <Modal title={`${editing ? '编辑' : '创建'}${tab === 'network' ? '网络' : '存储'}配置`} description="从资源清单直接选择来源和目标，并确认受影响的虚拟机。" open={open} onClose={close} size="large"
      footer={<><Button variant="secondary" onClick={close}>取消</Button><Button disabled={!name || Boolean(nameError) || !sourceName || !destinationName || !rowsValid || activePending} onClick={save}>{activePending ? '正在保存...' : editing ? '保存修改' : '创建配置'}</Button></>}>
      {activeError && <Alert tone="danger" title="保存失败">{activeError.message}</Alert>}
      {inventoryError && <Alert tone="warning" title="部分资源清单暂时不可用">仍可选择“手动输入”完成配置。{inventoryError instanceof Error ? ` ${inventoryError.message}` : ''}</Alert>}
      <div className="form-grid mapping-provider-fields" style={{ marginTop: activeError || inventoryError ? 16 : 0 }}>
        <Field label="名称" required help="用于唯一标识此配置，创建后不可修改"><div className="identifier-input"><input value={name} disabled={Boolean(editing)} onChange={(event) => setName(event.target.value)} placeholder={tab === 'storage' ? 'production-storage' : 'production-networks'} />{!editing && name && nameError && <Button type="button" variant="secondary" onClick={() => setName(compliantName(name))}>生成合规名称</Button>}</div>{nameError && <small className="field-error">{nameError}</small>}</Field>
        <Field label="源集群" required><Select value={sourceName} disabled={Boolean(editing)} onChange={(event) => resetRowsForSource(event.target.value)}>{sourceProviders.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
        <Field label="EIS 目标集群" required><Select value={destinationName} disabled={Boolean(editing)} onChange={(event) => { setDestinationName(event.target.value); setRows((current) => current.map((row) => ({ ...row, targetResource: tab === 'storage' ? config.defaultStorageClass : '', targetNamespace: undefined, manualTarget: false }))); }}>{destinations.map((provider) => <option key={provider.metadata.name}>{provider.metadata.name}</option>)}</Select></Field>
      </div>
      <div className="mapping-editor-header"><div><strong>资源对应关系</strong><span>{inventoryLoading ? '正在读取资源清单...' : `共 ${rows.length} 条`}</span></div><Button variant="secondary" icon={<Plus size={15} />} onClick={addRow}>添加一条</Button></div>
      {duplicateSources && <Alert tone="danger" title="存在重复的源资源">同一个源网络或源存储只能配置一次，请删除或修改重复条目。</Alert>}
      <div className="mapping-editor-list">{rows.map((row, index) => {
        const currentSourceValue = sourceSelectionValue(row);
        const sourceFound = sourceResources.some((resource) => source && inventoryResourceKey(resource, source.spec.type) === currentSourceValue);
        const selectedSource = sourceResources.find((resource) => source && inventoryResourceKey(resource, source.spec.type) === currentSourceValue);
        const usedBy = usageFor(selectedSource);
        const currentTargetValue = targetSelectionValue(row);
        const targetFound = targetResources.some((resource) => destination && inventoryResourceKey(resource, destination.spec.type) === currentTargetValue);
        return <section className="mapping-row-editor" key={row.key}>
          <div className="mapping-row-heading"><strong>条目 {index + 1}</strong><IconButton label={`删除条目 ${index + 1}`} disabled={rows.length === 1} onClick={() => removeRow(row.key)}><Trash2 size={15} /></IconButton></div>
          <div className={`form-grid ${tab === 'storage' ? 'mapping-storage-fields' : ''}`}>
            <Field label={tab === 'storage' ? '源存储' : '源网络'} required help="名称后会显示资源标识和正在使用它的虚拟机数量">
              <Select aria-label={tab === 'storage' ? '源存储' : '源网络'} value={currentSourceValue} onChange={(event) => selectSourceResource(row, event.target.value)}>
                <option value="">请选择源资源</option>
                {sourceResources.map((resource) => {
                  const resourceUsage = usageFor(resource);
                  const resourceId = resource.id || resource.uid;
                  return <option key={inventoryResourceKey(resource, source!.spec.type)} value={inventoryResourceKey(resource, source!.spec.type)}>{resource.name}{resource.namespace ? ` · ${resource.namespace}` : ''}{resourceId ? ` · ${resourceId}` : ''} · {resourceUsage.length} 台虚机</option>;
                })}
                {currentSourceValue && !sourceFound && !row.manualSource && <option value={currentSourceValue}>{row.sourceName || row.sourceId} · 当前配置</option>}
                <option value={manualValue}>手动输入...</option>
              </Select>
            </Field>
            <Field label={tab === 'storage' ? '目标存储' : '目标网络'} required={tab === 'storage'} help={tab === 'network' ? '可选择默认集群网络或附加业务网络' : undefined}>
              <Select aria-label={tab === 'storage' ? '目标存储' : '目标网络'} value={currentTargetValue} onChange={(event) => selectTargetResource(row, event.target.value)}>
                {tab === 'network' && <option value={defaultNetworkValue}>默认集群网络</option>}
                {targetResources.map((resource) => {
                  const value = inventoryResourceKey(resource, destination!.spec.type);
                  const isDefault = resource.object?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
                  return <option key={value} value={value}>{resource.namespace ? `${resource.namespace} / ` : ''}{resource.name}{isDefault ? ' · 默认' : ''}</option>;
                })}
                {currentTargetValue !== defaultNetworkValue && currentTargetValue && !targetFound && !row.manualTarget && <option value={currentTargetValue}>{row.targetResource} · 当前配置</option>}
                <option value={manualValue}>手动输入...</option>
              </Select>
            </Field>
            {tab === 'storage' ? <>
              <Field label="磁盘呈现方式" required><Select value={row.volumeMode} onChange={(event) => updateRow(row.key, { volumeMode: event.target.value as VolumeMode })}><option value="Block">块设备</option><option value="Filesystem">文件系统</option></Select></Field>
              <Field label="磁盘使用方式" required><Select value={row.accessMode} onChange={(event) => updateRow(row.key, { accessMode: event.target.value as AccessMode })}><option value="ReadWriteMany">多节点读写</option><option value="ReadWriteOnce">单节点读写</option><option value="ReadOnlyMany">多节点只读</option></Select></Field>
            </> : row.targetResource ? <Field label="IP 配置"><Select value={row.networkIPMode} onChange={(event) => updateRow(row.key, { networkIPMode: event.target.value as NetworkIPMode })}><option value="preserve">保留源配置</option><option value="dhcp">自动获取</option><option value="none">不配置</option></Select></Field> : <div className="mapping-default-note">虚拟机将接入默认集群网络。</div>}
          </div>
          {row.manualSource && <div className="mapping-manual-fields"><Field label="源资源 ID 或名称" required><input value={row.sourceId || row.sourceName || ''} onChange={(event) => updateRow(row.key, source?.spec.type === 'openshift' ? { sourceName: event.target.value, sourceId: '' } : { sourceId: event.target.value, sourceName: undefined })} placeholder="输入资源标识" /></Field>{source?.spec.type === 'openshift' && <Field label="源资源空间" required><input value={row.sourceNamespace || ''} onChange={(event) => updateRow(row.key, { sourceNamespace: event.target.value })} placeholder="例如 vm-workloads" /></Field>}</div>}
          {row.manualTarget && <div className="mapping-manual-fields"><Field label={tab === 'storage' ? '目标存储名称' : '目标网络名称'} required><input value={row.targetResource} onChange={(event) => updateRow(row.key, { targetResource: event.target.value })} placeholder="输入目标资源名称" /></Field>{tab === 'network' && <Field label="目标资源空间" required><input value={row.targetNamespace || ''} onChange={(event) => updateRow(row.key, { targetNamespace: event.target.value })} placeholder="例如 vm-workloads" /></Field>}</div>}
          {selectedSource && <div className={`resource-usage ${usedBy.length ? 'has-usage' : ''}`}><Users size={15} /><span>{usedBy.length ? <><strong>{usedBy.length} 台虚拟机正在使用：</strong>{usedBy.map((vm) => vm.name).join('、')}</> : '资源清单中暂未关联到虚拟机'}</span></div>}
        </section>;
      })}</div>
    </Modal>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      title={`删除${deleteTarget?.kind === 'StorageMap' ? '存储' : '网络'}配置`}
      description={deleteTarget ? `删除 ${deleteTarget.metadata.name} 后将无法恢复。${referencingPlans(deleteTarget).length ? `引用记录：${referencingPlans(deleteTarget).map((plan) => plan.metadata.name).join('、')}。` : '当前没有迁移任务引用此配置。'}` : ''}
      confirmLabel="确认删除"
      pending={deleteTarget?.kind === 'StorageMap' ? deleteStorage.isPending : deleteNetwork.isPending}
      pendingLabel={`正在删除${deleteTarget?.kind === 'StorageMap' ? '存储' : '网络'}配置...`}
      error={deleteTarget?.kind === 'StorageMap' ? deleteStorage.error : deleteNetwork.error}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => {
        if (!deleteTarget) return;
        const mutation = deleteTarget.kind === 'StorageMap' ? deleteStorage : deleteNetwork;
        mutation.mutate(deleteTarget.metadata.name, { onSuccess: () => setDeleteTarget(undefined) });
      }}
    />
  </>;
}
