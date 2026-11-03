import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CirclePlay, Eye, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCreateResource, useNetworkMaps, usePlans, useStorageMaps } from '../api/hooks';
import { appendPlanAction, deleteResource } from '../api/client';
import { buildMigration } from '../domain/builders';
import { getMigrationTypeLabel, getPlanActivityTime, getPlanMigrationType, getPlanStatus, getVmFailure, isPlanEditable, isPlanReady } from '../domain/status';
import type { Migration, Plan } from '../domain/types';
import { Button, ConfirmDialog, PageState, Pagination, Select, StatusBadge, formatDate } from '../components/ui';

export function PlansPage() {
  const query = usePlans();
  const networkMaps = useNetworkMaps();
  const storageMaps = useStorageMaps();
  const queryClient = useQueryClient();
  const createMigration = useCreateResource<Migration>('migrations');
  const remove = useMutation({
    mutationFn: async (plan: Plan) => {
      await deleteResource('plans', plan.metadata.name);
      const managedNetworks = (networkMaps.data?.items || []).filter((mapping) => mapping.metadata.labels?.['eis-dmt.io/managed-for-task'] === plan.metadata.name);
      const managedStorages = (storageMaps.data?.items || []).filter((mapping) => mapping.metadata.labels?.['eis-dmt.io/managed-for-task'] === plan.metadata.name);
      await Promise.allSettled([
        ...managedNetworks.map((mapping) => deleteResource('networkmaps', mapping.metadata.name)),
        ...managedStorages.map((mapping) => deleteResource('storagemaps', mapping.metadata.name)),
      ]);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plans'] }),
        queryClient.invalidateQueries({ queryKey: ['networkmaps'] }),
        queryClient.invalidateQueries({ queryKey: ['storagemaps'] }),
      ]);
    },
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filter = searchParams.get('status') || 'all';
  const [confirmAction, setConfirmAction] = useState<{ kind: 'start' | 'delete'; plan: Plan }>();
  const [startingPlanName, setStartingPlanName] = useState('');
  const plans = useMemo(() => (query.data?.items || [])
    .filter((plan) => {
      const status = getPlanStatus(plan);
      return `${plan.metadata.name} ${plan.spec.description || ''}`.toLowerCase().includes(search.toLowerCase())
        && (filter === 'all' || status.tone === filter || (filter === 'vm-failed' && (plan.status?.migration?.vms || []).some(getVmFailure)));
    })
    .sort((left, right) => getPlanActivityTime(right) - getPlanActivityTime(left)
      || left.metadata.name.localeCompare(right.metadata.name)), [query.data, search, filter]);
  const pageSize = 15;
  const pageCount = Math.max(1, Math.ceil(plans.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedPlans = plans.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (!startingPlanName) return;
    const current = query.data?.items.find((plan) => plan.metadata.name === startingPlanName);
    if (!current || !isPlanReady(current)) {
      const timer = window.setTimeout(() => setStartingPlanName(''), 0);
      return () => window.clearTimeout(timer);
    }
  }, [query.data, query.dataUpdatedAt, startingPlanName]);

  return <>
    <div className="page-heading"><div><h2>迁移任务</h2><p>创建迁移批次并跟踪每台虚拟机的复制、转换和导入阶段。</p></div><Link className="button button-primary" to="/plans/new"><Plus size={16} />创建任务</Link></div>
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索任务名称或描述" /></div>
        <Select className="input" style={{ width: 160 }} value={filter} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value === 'all') next.delete('status'); else next.set('status', event.target.value); setSearchParams(next); setPage(1); }}><option value="all">全部状态</option><option value="ready">可执行</option><option value="running">迁移中</option><option value="success">已完成</option><option value="danger">失败/阻塞</option><option value="vm-failed">含失败虚拟机</option></Select>
      </div>
      <PageState loading={query.isLoading} error={query.error} empty={plans.length === 0} emptyText="暂无迁移任务">
        <table className="data-table"><thead><tr><th>任务</th><th>迁移路径</th><th>迁移类型</th><th>虚拟机</th><th>状态</th><th>最近活动</th><th aria-label="操作" /></tr></thead>
          <tbody>{pagedPlans.map((plan) => {
            const status = getPlanStatus(plan);
            const isStarting = startingPlanName === plan.metadata.name;
            return <tr key={plan.metadata.name}>
              <td><Link to={`/plans/${plan.metadata.name}`}>{plan.metadata.name}</Link><span className="cell-subtitle">{plan.spec.description || '无描述'}</span></td>
              <td>{plan.spec.provider.source.name} → {plan.spec.provider.destination.name}<span className="cell-subtitle">目标 {plan.spec.targetNamespace}</span></td>
              <td><span className="type-badge">{getMigrationTypeLabel(getPlanMigrationType(plan))}</span></td><td>{plan.spec.vms.length}</td>
              <td><StatusBadge tone={isStarting ? 'running' : status.tone}>{isStarting ? <><LoaderCircle className="spin" size={12} />启动中</> : status.label}</StatusBadge>{!isStarting && status.reason && <span className="cell-subtitle">{status.reason}</span>}</td>
              <td>{formatDate(new Date(getPlanActivityTime(plan)).toISOString())}</td>
              <td><div className="page-actions plan-row-actions">
                {isStarting
                  ? <Button className="button-compact" icon={<LoaderCircle className="spin" size={16} />} disabled>正在启动</Button>
                  : isPlanReady(plan) && <Button className="button-compact" icon={<CirclePlay size={16} />} disabled={createMigration.isPending} onClick={() => { createMigration.reset(); setConfirmAction({ kind: 'start', plan }); }}>开始迁移</Button>}
                <Link className="button button-secondary button-compact" to={`/plans/${plan.metadata.name}`}><Eye size={15} />查看详情</Link>
                {isPlanEditable(plan) && <Link className="button button-secondary button-compact" aria-label={`编辑 ${plan.metadata.name}`} to={`/plans/${plan.metadata.name}/edit`}><Pencil size={15} />编辑</Link>}
                {!['running'].includes(status.tone) && <Button className="button-compact plan-delete-action" variant="secondary" icon={<Trash2 size={15} />} onClick={() => { remove.reset(); setConfirmAction({ kind: 'delete', plan }); }}>删除</Button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
        <Pagination page={currentPage} pageSize={pageSize} total={plans.length} onPageChange={setPage} />
      </PageState>
    </section>
    <ConfirmDialog
      open={Boolean(confirmAction)}
      title={confirmAction?.kind === 'start' ? '开始迁移任务' : '删除迁移任务'}
      description={confirmAction?.kind === 'start'
        ? `将立即开始执行 ${confirmAction.plan.metadata.name}，请确认迁移范围和业务窗口已经准备就绪。`
        : `删除 ${confirmAction?.plan.metadata.name || ''} 后，任务配置及该任务专用的网络、存储配置将无法恢复；目标虚拟机和公共配置不会被删除。`}
      confirmLabel={confirmAction?.kind === 'start' ? '确认开始' : '确认删除'}
      danger={confirmAction?.kind !== 'start'}
      pending={confirmAction?.kind === 'start' ? createMigration.isPending : remove.isPending}
      pendingLabel={confirmAction?.kind === 'start' ? '正在启动任务...' : '正在删除任务...'}
      error={confirmAction?.kind === 'start' ? createMigration.error : remove.error}
      onClose={() => setConfirmAction(undefined)}
      onConfirm={() => {
        if (!confirmAction) return;
        if (confirmAction.kind === 'start') {
          setStartingPlanName(confirmAction.plan.metadata.name);
          createMigration.mutate(buildMigration(confirmAction.plan), {
            onSuccess: () => { appendPlanAction(confirmAction.plan.metadata.name, '从任务列表开始迁移').catch(() => undefined); setConfirmAction(undefined); },
            onError: () => setStartingPlanName(''),
          });
        }
        else remove.mutate(confirmAction.plan, { onSuccess: () => setConfirmAction(undefined) });
      }}
    />
  </>;
}
