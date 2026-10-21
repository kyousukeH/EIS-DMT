import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, Pencil, Plus, Search, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDeleteResource, usePlans, useProviders } from '../api/hooks';
import { createProviderWithSecret, getRuntimeConfig, updateProviderWithSecret } from '../api/client';
import { getPlanStatus } from '../domain/status';
import type { Provider, ProviderType } from '../domain/types';
import { isEISTargetProvider, providerDisplayType, providerRoleLabel, providerTypeLabels } from '../domain/providers';
import { Alert, Button, ConfirmDialog, Field, IconButton, Modal, PageState, Select, StatusBadge, formatDate } from '../components/ui';

function readiness(provider: Provider) {
  const ready = provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True');
  const failure = provider.status?.conditions?.find((condition) => condition.status === 'True' && ['Critical', 'Error'].includes(condition.category || ''))
    || provider.status?.conditions?.find((condition) => condition.type === 'Ready' && condition.status === 'False');
  return { ready, reason: failure?.message || failure?.reason };
}

export function ProvidersPage({ role }: { role: 'source' | 'target' }) {
  const query = useProviders();
  const plans = usePlans();
  const queryClient = useQueryClient();
  const remove = useDeleteResource('providers');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider>();
  const [type, setType] = useState<ProviderType>(role === 'target' ? 'openshift' : 'vsphere');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [skipTls, setSkipTls] = useState(false);
  const [certificateMode, setCertificateMode] = useState<'keep' | 'verify' | 'skip'>('keep');
  const [vddk, setVddk] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Provider>();

  const reset = () => {
    setEditing(undefined);
    setType(role === 'target' ? 'openshift' : 'vsphere');
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    setToken('');
    setSkipTls(false);
    setCertificateMode('keep');
    setVddk('');
  };
  const close = () => { setOpen(false); reset(); };
  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setType(provider.spec.type);
    setName(provider.metadata.name);
    setUrl(provider.spec.url || '');
    setVddk(String(provider.spec.settings?.vddkInitImage || ''));
    setUsername('');
    setPassword('');
    setToken('');
    setCertificateMode('keep');
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const namespace = getRuntimeConfig().namespace;
      const provider: Provider = editing ? {
        ...editing,
        spec: {
          ...editing.spec,
          url,
          ...(type === 'vsphere' ? { settings: { ...editing.spec.settings, vddkInitImage: vddk } } : {}),
        },
      } : {
        apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Provider',
        metadata: {
          name, namespace,
          ...(role === 'target' ? { labels: { [providerRoleLabel]: 'target' } } : {}),
        },
        spec: {
          type, url,
          secret: { name: `${name}-credentials`, namespace },
          ...(type === 'vsphere' && vddk ? { settings: { vddkInitImage: vddk } } : {}),
        },
      };
      if (role === 'target') {
        provider.metadata.labels = { ...provider.metadata.labels, [providerRoleLabel]: 'target' };
      }
      const stringData: Record<string, string> = {};
      if (!editing) stringData.insecureSkipVerify = String(skipTls);
      if (editing && certificateMode !== 'keep') stringData.insecureSkipVerify = String(certificateMode === 'skip');
      if (type === 'openshift') {
        if (token) stringData.token = token;
      } else if (type === 'ec2') {
        if (username) stringData.accessKeyId = username;
        if (password) stringData.secretAccessKey = password;
      } else {
        if (username) stringData[type === 'hyperv' || type === 'openstack' ? 'username' : 'user'] = username;
        if (password) stringData.password = password;
      }
      return editing
        ? updateProviderWithSecret(provider, stringData)
        : createProviderWithSecret(provider, stringData);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['providers'] }); close(); },
  });

  const items = useMemo(() => (query.data?.items || []).filter((provider) =>
    `${provider.metadata.name} ${provider.spec.type} ${provider.spec.url || ''}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const visibleItems = items.filter((provider) => role === 'target' ? isEISTargetProvider(provider) : !isEISTargetProvider(provider));
  const runningProviderNames = new Set((plans.data?.items || [])
    .filter((plan) => getPlanStatus(plan).tone === 'running')
    .flatMap((plan) => [plan.spec.provider.source.name, plan.spec.provider.destination.name]));
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };
  const isToken = type === 'openshift';
  const localTarget = Boolean(editing && isEISTargetProvider(editing) && !editing.spec.url);
  const saveDisabled = !name || (!url && !localTarget) || (!editing && isToken && !token) || save.isPending;

  const providerTable = (providers: Provider[]) => <PageState
    loading={query.isLoading}
    error={query.error}
    empty={providers.length === 0}
    emptyText={role === 'source' ? '没有符合条件的源集群' : '未找到 EIS 目标集群连接'}
  >
    <table className="data-table provider-table">
      <thead><tr><th>名称</th><th>平台类型</th><th>连接状态</th><th>连接地址</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
      <tbody>{providers.map((provider) => {
        const state = readiness(provider);
        const target = isEISTargetProvider(provider);
        const managedTarget = target && provider.metadata.labels?.[providerRoleLabel] === 'target';
        const usedByRunningPlan = runningProviderNames.has(provider.metadata.name);
        const lockedReason = usedByRunningPlan ? '该连接正被执行中的迁移使用' : undefined;
        return <tr key={provider.metadata.name}>
          <td><span className="cell-title">{provider.metadata.name}</span><span className="cell-subtitle">{target ? '迁移后的虚拟机将运行在这里' : state.reason || '虚拟机资源已同步'}</span></td>
          <td><span className="type-badge">{providerDisplayType(provider)}</span></td>
          <td><StatusBadge tone={state.ready ? 'success' : 'danger'}>{state.ready ? '连接正常' : '连接异常'}</StatusBadge></td>
          <td>{provider.spec.url || 'EIS 本地集群'}</td><td>{formatDate(provider.metadata.creationTimestamp)}</td>
          <td><div className="page-actions">
            <Link className="icon-button" aria-label={`查看 ${provider.metadata.name} 的虚拟机`} title="查看虚拟机" to={target ? `/vms/target?target=${encodeURIComponent(provider.metadata.name)}` : `/vms/source?provider=${encodeURIComponent(provider.metadata.name)}`}><Monitor size={16} /></Link>
            <IconButton label={`编辑 ${provider.metadata.name}`} title={lockedReason || '编辑集群连接'} disabled={Boolean(lockedReason)} onClick={() => openEdit(provider)}><Pencil size={16} /></IconButton>
            {(!target || managedTarget) && <IconButton label={`删除 ${provider.metadata.name}`} title={lockedReason || '删除集群连接'} disabled={Boolean(lockedReason)} onClick={() => { remove.reset(); setDeleteTarget(provider); }}><Trash2 size={16} /></IconButton>}
          </div></td>
        </tr>;
      })}</tbody>
    </table>
  </PageState>;

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">{role === 'source' ? '迁移准备 · 第 1 步' : '迁移接收环境'}</span>
        <h2>{role === 'source' ? '源集群' : '目标集群'}</h2>
        <p>{role === 'source' ? '连接虚拟机当前所在的集群，连接成功后即可查看并选择待迁移虚拟机。' : '查看用于接收迁移结果的 EIS 目标集群，以及集群中的目标虚拟机。'}</p>
      </div>
      <Button icon={<Plus size={16} />} onClick={openCreate}>{role === 'source' ? '连接源集群' : '添加目标集群'}</Button>
    </div>

    <div className={`provider-page-intro ${role}`}>
      <span className={`provider-role-icon ${role}`}>{role === 'source' ? <Server size={23} /> : <ShieldCheck size={23} />}</span>
      <div><strong>{role === 'source' ? '虚拟机从这里迁出' : '虚拟机将迁移到这里'}</strong><span>{role === 'source' ? '支持连接 VMware、KubeVirt、OpenStack 等虚拟化环境。' : '目标集群由 EIS 平台管理，资源状态会持续同步。'}</span></div>
      <b>{visibleItems.length} 个集群</b>
    </div>

    <section className="panel table-panel provider-section">
      <div className="provider-section-title"><div><span className={`provider-section-icon ${role}`}>{role === 'source' ? <Server size={18} /> : <ShieldCheck size={18} />}</span><div><h3>{role === 'source' ? '已连接的源集群' : '可用的目标集群'}</h3><p>{role === 'source' ? '管理原有环境并查看可迁移资源。' : '选择集群可查看迁移后及原有的虚拟机。'}</p></div></div><span>{visibleItems.length} 个集群</span></div>
      <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索集群名称、平台类型或地址" /></div></div>
      {providerTable(visibleItems)}
    </section>

    <Modal title={editing ? `编辑${role === 'source' ? '源' : '目标'}集群连接` : `${role === 'source' ? '连接源集群' : '添加目标集群'}`} description={editing ? '更新连接信息；凭据留空时保留当前值。' : role === 'source' ? '填写原有虚拟机所在环境的连接信息，凭据将由平台安全保存。' : '连接用于接收迁移结果的 EIS 目标集群。'} open={open} onClose={close}
      footer={<><Button variant="secondary" onClick={close}>取消</Button><Button disabled={saveDisabled} onClick={() => save.mutate()}>{save.isPending ? '正在保存...' : editing ? '保存修改' : '创建并连接'}</Button></>}>
      <form onSubmit={submit}>
        {save.error && <Alert tone="danger" title={editing ? '保存失败' : '创建失败'}>{save.error.message}</Alert>}
        <div className="form-grid" style={{ marginTop: save.error ? 16 : 0 }}>
          <Field label={role === 'source' ? '源平台类型' : '目标平台类型'} required><Select value={type} disabled={Boolean(editing) || role === 'target'} onChange={(event) => setType(event.target.value as ProviderType)}>{(role === 'target' ? ([['openshift', providerTypeLabels.openshift]] as Array<[string, string]>) : Object.entries(providerTypeLabels)).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
          <Field label="名称" required help="名称创建后不可修改"><input value={name} disabled={Boolean(editing)} onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, ''))} placeholder={role === 'source' ? 'production-vcenter' : 'eis-target-prod'} pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?" /></Field>
          <Field label="API 地址" required={!localTarget} help={localTarget ? '当前为本地目标集群，留空即可；填写地址可改为远程连接。' : type === 'vsphere' ? '例如 https://vcenter.example/sdk' : '例如 https://api.cluster.example:6443'}><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={localTarget ? '本地目标集群无需填写' : 'https://...'} /></Field>
          {isToken ? <Field label="访问令牌" required={!editing} help={editing ? '留空保留当前令牌' : '用于读取远端 KubeVirt 集群中的虚拟机和资源'}><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" /></Field> : <>
            <Field label={type === 'ec2' ? 'Access Key ID' : '用户名'} required={!editing} help={editing ? '留空保留当前值' : undefined}><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></Field>
            <Field label={type === 'ec2' ? 'Secret Access Key' : '密码'} required={!editing} help={editing ? '留空保留当前值' : undefined}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
          </>}
          {type === 'vsphere' && <Field label="VDDK 镜像" help="生产迁移建议配置离线仓库中的 VDDK 镜像"><input value={vddk} onChange={(event) => setVddk(event.target.value)} placeholder="registry.internal/vddk:8.0.3" /></Field>}
          {editing
            ? <Field label="证书校验策略"><Select value={certificateMode} onChange={(event) => setCertificateMode(event.target.value as typeof certificateMode)}><option value="keep">保持当前设置</option><option value="verify">启用证书校验</option><option value="skip">跳过证书校验</option></Select></Field>
            : <label className="checkbox-field span-2"><input type="checkbox" checked={skipTls} onChange={(event) => setSkipTls(event.target.checked)} /><span><strong>跳过证书校验</strong><small>仅在无法提供可信证书时使用，生产环境不推荐。</small></span></label>}
        </div>
      </form>
    </Modal>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      title={`删除${role === 'source' ? '源' : '目标'}集群连接`}
      description={`删除 ${deleteTarget?.metadata.name || ''} 后，将无法继续读取其中的虚拟机，相关迁移计划也会停止同步。`}
      confirmLabel="确认删除"
      pending={remove.isPending}
      error={remove.error}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => deleteTarget && remove.mutate(deleteTarget.metadata.name, { onSuccess: () => setDeleteTarget(undefined) })}
    />
  </>;
}
