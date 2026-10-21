import { useMemo, useState } from 'react';
import { Archive, Eye, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCreateResource, useDeleteResource, usePlans } from '../api/hooks';
import { buildMigration } from '../domain/builders';
import { getPlanMigrationType, getPlanStatus, getVmFailure, isPlanEditable, isPlanReady } from '../domain/status';
import type { Migration, Plan } from '../domain/types';
import { ConfirmDialog, IconButton, PageState, Select, StatusBadge, formatDate } from '../components/ui';

export function PlansPage() {
  const query = usePlans();
  const createMigration = useCreateResource<Migration>('migrations');
  const remove = useDeleteResource('plans');
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const filter = searchParams.get('status') || 'all';
  const [confirmAction, setConfirmAction] = useState<{ kind: 'start' | 'delete'; plan: Plan }>();
  const plans = useMemo(() => (query.data?.items || []).filter((plan) => {
    const status = getPlanStatus(plan);
    return `${plan.metadata.name} ${plan.spec.description || ''}`.toLowerCase().includes(search.toLowerCase())
      && (filter === 'all' || status.tone === filter || (filter === 'vm-failed' && (plan.status?.migration?.vms || []).some(getVmFailure)));
  }), [query.data, search, filter]);

  return <>
    <div className="page-heading"><div><h2>迁移计划</h2><p>创建迁移批次并跟踪每台虚拟机的复制、转换和导入阶段。</p></div><Link className="button button-primary" to="/plans/new"><Plus size={16} />创建计划</Link></div>
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索计划名称或描述" /></div>
        <Select className="input" style={{ width: 160 }} value={filter} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value === 'all') next.delete('status'); else next.set('status', event.target.value); setSearchParams(next); }}><option value="all">全部状态</option><option value="ready">可执行</option><option value="running">迁移中</option><option value="success">已完成</option><option value="danger">失败/阻塞</option><option value="vm-failed">含失败虚拟机</option></Select>
      </div>
      <PageState loading={query.isLoading} error={query.error} empty={plans.length === 0} emptyText="暂无迁移计划">
        <table className="data-table"><thead><tr><th>计划</th><th>迁移路径</th><th>类型</th><th>虚拟机</th><th>状态</th><th>最近执行</th><th aria-label="操作" /></tr></thead>
          <tbody>{plans.map((plan) => {
            const status = getPlanStatus(plan);
            return <tr key={plan.metadata.name}>
              <td><Link to={`/plans/${plan.metadata.name}`}>{plan.metadata.name}</Link><span className="cell-subtitle">{plan.spec.description || '无描述'}</span></td>
              <td>{plan.spec.provider.source.name} → {plan.spec.provider.destination.name}<span className="cell-subtitle">目标 {plan.spec.targetNamespace}</span></td>
              <td><span className="type-badge">{getPlanMigrationType(plan)}</span></td><td>{plan.spec.vms.length}</td>
              <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{status.reason && <span className="cell-subtitle">{status.reason}</span>}</td>
              <td>{formatDate(plan.status?.migration?.started || plan.metadata.creationTimestamp)}</td>
              <td><div className="page-actions">
                <Link className="button button-secondary button-compact" to={`/plans/${plan.metadata.name}`}><Eye size={15} />查看详情</Link>
                {isPlanEditable(plan) && <Link className="icon-button" aria-label={`编辑 ${plan.metadata.name}`} title="编辑计划" to={`/plans/${plan.metadata.name}/edit`}><Pencil size={16} /></Link>}
                {isPlanReady(plan) && <IconButton label="开始迁移" disabled={createMigration.isPending} onClick={() => { createMigration.reset(); setConfirmAction({ kind: 'start', plan }); }}><Play size={16} /></IconButton>}
                {status.tone === 'success' && <IconButton label="归档计划"><Archive size={16} /></IconButton>}
                {!['running'].includes(status.tone) && <IconButton label="删除计划" onClick={() => { remove.reset(); setConfirmAction({ kind: 'delete', plan }); }}><Trash2 size={16} /></IconButton>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </PageState>
    </section>
    <ConfirmDialog
      open={Boolean(confirmAction)}
      title={confirmAction?.kind === 'start' ? '开始迁移计划' : '删除迁移计划'}
      description={confirmAction?.kind === 'start'
        ? `将立即开始执行 ${confirmAction.plan.metadata.name}，请确认迁移范围和业务窗口已经准备就绪。`
        : `删除 ${confirmAction?.plan.metadata.name || ''} 后，该计划配置将无法恢复。历史目标虚拟机不会被删除。`}
      confirmLabel={confirmAction?.kind === 'start' ? '确认开始' : '确认删除'}
      danger={confirmAction?.kind !== 'start'}
      pending={confirmAction?.kind === 'start' ? createMigration.isPending : remove.isPending}
      error={confirmAction?.kind === 'start' ? createMigration.error : remove.error}
      onClose={() => setConfirmAction(undefined)}
      onConfirm={() => {
        if (!confirmAction) return;
        if (confirmAction.kind === 'start') createMigration.mutate(buildMigration(confirmAction.plan), { onSuccess: () => setConfirmAction(undefined) });
        else remove.mutate(confirmAction.plan.metadata.name, { onSuccess: () => setConfirmAction(undefined) });
      }}
    />
  </>;
}
