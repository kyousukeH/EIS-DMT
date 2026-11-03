import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Circle, Clock3, Pause, Pencil, Play, RefreshCw, RotateCcw, Undo2, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateResource, useMigrations, usePatchResource, usePlans } from '../api/hooks';
import { appendPlanAction, planActionHistoryAnnotation, queuePlanStart, rollbackPlanResources, type PlanActionRecord } from '../api/client';
import { buildMigration } from '../domain/builders';
import { translateMigrationErrors } from '../domain/errors';
import { formatBytes } from '../domain/format';
import {
  getBaseDiskTransferStep,
  getCurrentDiskTransferStep,
  diskTransferProgressPercent,
  getLatestMigration,
  getMigrationPhaseLabel,
  getMigrationStepLabel,
  getMigrationTaskLabel,
  getMigrationTypeLabel,
  getPlanMigrationType,
  getPlanStatus,
  getStepFailure,
  getVmFailure,
  isDiskTransferStep,
  isDiskTransferComplete,
  isStepComplete,
  isPlanEditable,
  isPlanReady,
  stepProgressPercent,
} from '../domain/status';
import type { Migration, MigrationStep, Plan, VMStatus } from '../domain/types';
import { Alert, Button, ConfirmDialog, Field, Modal, PageState, ProgressBar, StatusBadge, formatDate } from '../components/ui';

function stepTone(step: MigrationStep, complete = isStepComplete(step)) {
  if (getStepFailure(step).length) return 'danger';
  if (complete) return 'success';
  if (/Running|Progress|Copying|Import/i.test(step.phase || '')) return 'running';
  return 'pending';
}

function ErrorGuidance({ reasons }: { reasons: string[] }) {
  return <>{translateMigrationErrors(reasons).map((friendly) => <li className="friendly-error" key={`${friendly.title}-${friendly.guidance}`}><strong>【{friendly.title}】</strong><span>{friendly.guidance}</span><details><summary>技术详情（{friendly.originals.length} 条）</summary>{friendly.originals.map((original) => <code key={original}>{original}</code>)}</details></li>)}</>;
}

function progressBytes(value: number, total: number) {
  return value * (total < 10_000_000 ? 1024 ** 2 : 1);
}

function etaLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '即将完成';
  if (seconds < 60) return '不足 1 分钟';
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return `约 ${Math.ceil(seconds / 3600)} 小时`;
}

function TransferMetrics({ step, complete }: { step: MigrationStep; fallbackStarted?: string; complete: boolean }) {
  const sample = useRef<{ bytes: number; at: number } | undefined>(undefined);
  const [bytesPerSecond, setBytesPerSecond] = useState(0);
  const total = step.progress?.total || 0;
  const completed = complete ? total : Math.min(step.progress?.completed || 0, total);
  const totalBytes = progressBytes(total, total);
  const completedBytes = progressBytes(completed, total);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const previous = sample.current;
      if (complete) setBytesPerSecond(0);
      else if (previous && completedBytes >= previous.bytes && now > previous.at) {
        setBytesPerSecond((completedBytes - previous.bytes) / ((now - previous.at) / 1000));
      }
      sample.current = { bytes: completedBytes, at: now };
    }, 0);
    return () => window.clearTimeout(timer);
  }, [completedBytes, complete]);
  if (total <= 0) return null;
  const remainingSeconds = bytesPerSecond > 0 ? (totalBytes - completedBytes) / bytesPerSecond : Number.POSITIVE_INFINITY;
  return <div className="transfer-metrics">
    <span><small>已传输</small><strong>{formatBytes(completedBytes)} / {formatBytes(totalBytes)}</strong></span>
    <span><small>实时速率</small><strong>{complete ? '已完成' : bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '计算中'}</strong></span>
    <span><small>预计剩余</small><strong>{complete ? '0 分钟' : bytesPerSecond > 0 ? etaLabel(remainingSeconds) : '计算中'}</strong></span>
  </div>;
}

function weightedTransferProgress(entries: Array<{ vm: VMStatus; step: MigrationStep }>) {
  const totals = entries.map(({ vm, step }) => {
    const total = progressBytes(step.progress?.total || 0, step.progress?.total || 0);
    const completed = isDiskTransferComplete(vm, step)
      ? total
      : progressBytes(Math.min(step.progress?.completed || 0, step.progress?.total || 0), step.progress?.total || 0);
    return { total, completed };
  }).filter((entry) => entry.total > 0);
  const total = totals.reduce((sum, entry) => sum + entry.total, 0);
  return total > 0 ? Math.round(totals.reduce((sum, entry) => sum + entry.completed, 0) / total * 100) : 0;
}

type VMFilter = 'all' | 'running' | 'waiting' | 'failed' | 'completed';

type PendingPlanAction = {
  kind: 'start' | 'cancel' | 'cancel-vm' | 'cutover' | 'clear-cutover';
  requestedAt: number;
  vmId?: string;
  baselineMigration?: string;
};

function migrationIdentity(migration?: Migration) {
  return migration?.metadata.uid || migration?.metadata.name || migration?.metadata.creationTimestamp || '';
}

function finalTransferHasStarted(vms: VMStatus[]) {
  return vms.some((vm) => (vm.pipeline || []).some((step) => {
    const finalTransfer = /Cutover/i.test(step.name) || /finalize disk transfer/i.test(step.description || '');
    return finalTransfer && Boolean(
      step.started
      || step.completed
      || /Running|Progress|Copying|Import|Completed|Succeeded/i.test(step.phase || '')
      || (step.progress?.completed || 0) > 0,
    );
  }));
}

function vmFilterState(vm: VMStatus, migrationType: string): Exclude<VMFilter, 'all'> {
  if (getVmFailure(vm)) return 'failed';
  if (vm.completed || /Completed|Succeeded/i.test(vm.phase || '')) return 'completed';
  if (migrationType === 'warm') {
    const base = getBaseDiskTransferStep(vm);
    const final = getCurrentDiskTransferStep(vm);
    const isFinalTransfer = Boolean(final && (/Cutover/i.test(final.name) || /finalize disk transfer/i.test(final.description || '')));
    const finalStarted = Boolean(final?.started || /Running|Progress|Copying/i.test(final?.phase || '') || (final?.progress?.completed || 0) > 0);
    if (base && isDiskTransferComplete(vm, base) && (!isFinalTransfer || !finalStarted)) return 'waiting';
  }
  return 'running';
}

function toLocalDateTime(value?: string, offsetMinutes = 60) {
  const date = value ? new Date(value) : new Date(Date.now() + offsetMinutes * 60_000);
  const validDate = Number.isNaN(date.getTime()) ? new Date(Date.now() + offsetMinutes * 60_000) : date;
  return new Date(validDate.getTime() - validDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function PlanDetailPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const migrations = useMigrations();
  const createMigration = useCreateResource<Migration>('migrations');
  const createRetryPlan = useCreateResource<Plan>('plans');
  const patchMigration = usePatchResource<Migration>('migrations');
  const retryAutoStart = useMutation({
    mutationFn: (targetPlan: Plan) => queuePlanStart(targetPlan.metadata.name, buildMigration(targetPlan)),
    onSuccess: (_result, targetPlan) => {
      appendPlanAction(targetPlan.metadata.name, '重新等待任务就绪并启动').catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
  });
  const [cutoverOpen, setCutoverOpen] = useState(false);
  const [cutoverMode, setCutoverMode] = useState<'now' | 'scheduled'>('now');
  const [cutoverAt, setCutoverAt] = useState(() => toLocalDateTime());
  const [minimumCutoverAt, setMinimumCutoverAt] = useState(() => toLocalDateTime(undefined, 0));
  const [cutoverRiskAccepted, setCutoverRiskAccepted] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const [rollbackSummary, setRollbackSummary] = useState('');
  const [cancelRequested, setCancelRequested] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [pendingPlanAction, setPendingPlanAction] = useState<PendingPlanAction>();
  const [taskOperationNotice, setTaskOperationNotice] = useState<{ tone: 'info' | 'danger'; title: string; message: string }>();
  const [vmFilter, setVmFilter] = useState<VMFilter>('all');
  const [confirmAction, setConfirmAction] = useState<{ kind: 'start' | 'cancel' | 'cancel-vm' | 'retry'; vmId?: string; resumeConversion?: boolean }>();
  const plan = plans.data?.items.find((item) => item.metadata.name === name);
  const latestMigrationSnapshot = plan ? getLatestMigration(plan, migrations.data?.items || []) : undefined;
  const planStatusSnapshot = plan ? getPlanStatus(plan) : undefined;
  const migrationVMsSnapshot = useMemo(() => plan?.status?.migration?.vms || [], [plan]);
  const finalTransferStartedSnapshot = finalTransferHasStarted(migrationVMsSnapshot);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pendingPlanAction || !plan || !planStatusSnapshot) return;
    const vm = pendingPlanAction.vmId
      ? migrationVMsSnapshot.find((item) => item.id === pendingPlanAction.vmId)
      : undefined;
    const completed = pendingPlanAction.kind === 'start'
      ? planStatusSnapshot.tone === 'running'
        || (migrationIdentity(latestMigrationSnapshot) !== pendingPlanAction.baselineMigration && Boolean(latestMigrationSnapshot))
      : pendingPlanAction.kind === 'cancel'
        ? planStatusSnapshot.tone !== 'running'
        : pendingPlanAction.kind === 'cancel-vm'
          ? planStatusSnapshot.tone !== 'running' || Boolean(vm && (vm.completed || /Canceled|Cancelled|Completed|Succeeded/i.test(vm.phase || '')))
          : pendingPlanAction.kind === 'cutover'
            ? planStatusSnapshot.tone !== 'running' || finalTransferStartedSnapshot
            : !latestMigrationSnapshot?.spec.cutover;
    if (completed) {
      const timer = window.setTimeout(() => setPendingPlanAction(undefined), 0);
      return () => window.clearTimeout(timer);
    }
    if (Date.now() - pendingPlanAction.requestedAt >= 180_000) {
      const timer = window.setTimeout(() => {
        setPendingPlanAction(undefined);
        setTaskOperationNotice({
          tone: 'danger',
          title: '操作状态确认超时',
          message: '后台已受理请求，但 3 分钟内未确认最终状态。请刷新任务并核对源端与目标端资源后再继续操作。',
        });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [finalTransferStartedSnapshot, latestMigrationSnapshot, migrationVMsSnapshot, pendingPlanAction, plan, planStatusSnapshot, plans.dataUpdatedAt, migrations.dataUpdatedAt]);
  const rollback = useMutation({
    mutationFn: ({ targetPlan, migration }: { targetPlan: NonNullable<typeof plan>; migration?: Migration }) => rollbackPlanResources(targetPlan, migration),
    onSuccess: () => {
      if (plan) appendPlanAction(plan.metadata.name, '提交一键回滚请求').catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['migrations'] });
      setRollbackSummary('回滚请求已提交，目标资源正在后台清理。请确认目标虚拟机和磁盘均已删除后再重新执行。');
      setRollbackOpen(false);
      setRollbackConfirmed(false);
    },
  });

  if (plans.isLoading) return <PageState loading />;
  if (!plan) return <Alert tone="danger" title="任务不存在">无法找到迁移任务 {name}。<div style={{ marginTop: 8 }}><Link to="/plans">返回列表</Link></div></Alert>;

  const status = planStatusSnapshot || getPlanStatus(plan);
  const migrationType = getPlanMigrationType(plan);
  const planReady = isPlanReady(plan);
  const latestMigration = latestMigrationSnapshot;
  const scheduledCutover = latestMigration?.spec.cutover;
  const autoStartStatus = plan.metadata.annotations?.['eis-dmt.io/auto-start-status'];
  const autoStartMessage = plan.metadata.annotations?.['eis-dmt.io/auto-start-message'];
  const showAutoStartState = status.tone !== 'running' && status.tone !== 'success';
  let actionHistory: PlanActionRecord[] = [];
  try {
    const stored = plan.metadata.annotations?.[planActionHistoryAnnotation];
    if (stored) actionHistory = JSON.parse(stored) as PlanActionRecord[];
  } catch {
    actionHistory = [];
  }
  const vms = plan.status?.migration?.vms || [];
  const failed = vms.filter((vm) => getVmFailure(vm));
  const completed = vms.filter((vm) => (vm.completed || /Completed|Succeeded/i.test(vm.phase || '')) && !getVmFailure(vm)).length;
  const allVmsComplete = vms.length > 0 && completed === vms.length;
  const copyEntries = vms.map((vm) => ({ vm, step: getCurrentDiskTransferStep(vm) })).filter((entry) => Boolean(entry.step)) as Array<{ vm: VMStatus; step: MigrationStep }>;
  const aggregateCopy = weightedTransferProgress(copyEntries);
  const baseCopyEntries = vms.map((vm) => ({ vm, step: getBaseDiskTransferStep(vm) })).filter((entry) => Boolean(entry.step)) as Array<{ vm: VMStatus; step: MigrationStep }>;
  const baseCopyPercent = baseCopyEntries.length ? Math.min(...baseCopyEntries.map((entry) => diskTransferProgressPercent(entry.vm, entry.step))) : 0;
  const cutoverHighRisk = baseCopyPercent < 95;
  const copyFailed = copyEntries.some(({ step }) => getStepFailure(step).length > 0);
  const copyComplete = copyEntries.length > 0 && copyEntries.every(({ vm, step }) => isDiskTransferComplete(vm, step));
  const scheduledDate = cutoverMode === 'scheduled' ? new Date(cutoverAt) : undefined;
  const invalidScheduledDate = cutoverMode === 'scheduled'
    && (!cutoverAt || Number.isNaN(scheduledDate?.getTime()) || Date.parse(cutoverAt) <= Date.parse(minimumCutoverAt));
  const vmCounts: Record<VMFilter, number> = {
    all: vms.length,
    running: vms.filter((vm) => vmFilterState(vm, migrationType) === 'running').length,
    waiting: vms.filter((vm) => vmFilterState(vm, migrationType) === 'waiting').length,
    failed: vms.filter((vm) => vmFilterState(vm, migrationType) === 'failed').length,
    completed: vms.filter((vm) => vmFilterState(vm, migrationType) === 'completed').length,
  };
  const filteredVMs = vmFilter === 'all' ? vms : vms.filter((vm) => vmFilterState(vm, migrationType) === vmFilter);
  const canRollback = !['已回滚', '回滚处理中'].includes(status.label) && (status.tone === 'danger' || failed.length > 0 || status.label === '已取消' || cancelRequested || Boolean(latestMigration?.spec.cancel?.length));
  const wholeTaskCancelRequested = pendingPlanAction?.kind === 'cancel'
    || Boolean(status.tone === 'running' && latestMigration?.spec.cancel && latestMigration.spec.cancel.length >= plan.spec.vms.length);
  const immediateCutoverRequested = pendingPlanAction?.kind === 'cutover'
    || Boolean(status.tone === 'running' && scheduledCutover && Date.parse(scheduledCutover) <= currentTime && !finalTransferStartedSnapshot);
  const cutoverInProgress = status.tone === 'running' && finalTransferStartedSnapshot && !allVmsComplete;
  const displayStatus = pendingPlanAction?.kind === 'start'
    ? { label: '启动中', tone: 'running' as const }
    : wholeTaskCancelRequested
      ? { label: '取消中', tone: 'warning' as const }
      : status;

  const start = (resumeConversion = false) => {
    if (!planReady) return;
    setTaskOperationNotice(undefined);
    setPendingPlanAction({ kind: 'start', requestedAt: Date.now(), baselineMigration: migrationIdentity(latestMigration) });
    createMigration.mutate(buildMigration(plan, { resumeConversion }), {
      onSuccess: () => {
        setConfirmAction(undefined);
        appendPlanAction(plan.metadata.name, resumeConversion ? '只重试系统适配' : '开始迁移任务').catch(() => undefined);
      },
      onError: () => setPendingPlanAction(undefined),
    });
  };
  const cancel = (vmId?: string) => {
    if (!latestMigration) return;
    const current = latestMigration.spec.cancel || [];
    const requested = vmId ? [{ id: vmId }] : plan.spec.vms.map((vm) => ({ id: vm.id }));
    const cancel = Array.from(new Map([...current, ...requested].map((item) => [item.id || ('name' in item ? item.name : undefined), item])).values());
    setTaskOperationNotice(undefined);
    setPendingPlanAction({ kind: vmId ? 'cancel-vm' : 'cancel', requestedAt: Date.now(), vmId });
    patchMigration.mutate(
      { name: latestMigration.metadata.name, patch: { spec: { cancel } } },
      {
        onSuccess: () => { setCancelRequested(true); setConfirmAction(undefined); appendPlanAction(plan.metadata.name, vmId ? '取消单台虚拟机' : '取消整个迁移任务', vmId).catch(() => undefined); },
        onError: () => setPendingPlanAction(undefined),
      },
    );
  };
  const createFocusedRetry = (vmIds?: string[]) => {
    const selected = vmIds || failed.map((vm) => vm.id);
    if (selected.length === 0) return;
    const existingNames = new Set((plans.data?.items || []).map((item) => item.metadata.name));
    let sequence = 1;
    let suffix = `retry-${sequence}`;
    let retryName = `${plan.metadata.name.slice(0, Math.max(1, 63 - suffix.length - 1))}-${suffix}`;
    while (existingNames.has(retryName)) {
      sequence += 1;
      suffix = `retry-${sequence}`;
      retryName = `${plan.metadata.name.slice(0, Math.max(1, 63 - suffix.length - 1))}-${suffix}`;
    }
    const retryPlan: Plan = {
      apiVersion: plan.apiVersion,
      kind: 'Plan',
      metadata: { name: retryName, namespace: plan.metadata.namespace },
      spec: {
        ...plan.spec,
        description: `${plan.spec.description || plan.metadata.name}（失败虚拟机重试）`,
        archived: false,
        vms: plan.spec.vms.filter((vm) => selected.includes(vm.id)),
      },
    };
    createRetryPlan.mutate(retryPlan, { onSuccess: () => {
      appendPlanAction(retryName, '创建失败项重试任务', `来源任务：${plan.metadata.name}`).catch(() => undefined);
      navigate(`/plans/${retryName}/edit`);
    } });
  };
  const openCutover = () => {
    const currentLocalTime = toLocalDateTime(undefined, 0);
    const hasFutureSchedule = Boolean(scheduledCutover && new Date(scheduledCutover).getTime() > Date.parse(currentLocalTime));
    setCutoverMode(hasFutureSchedule ? 'scheduled' : 'now');
    setCutoverAt(toLocalDateTime(scheduledCutover || undefined));
    setMinimumCutoverAt(currentLocalTime);
    setCutoverRiskAccepted(false);
    patchMigration.reset();
    setCutoverOpen(true);
  };
  const closeCutover = () => {
    setCutoverOpen(false);
    patchMigration.reset();
  };
  const saveCutover = () => {
    if (!latestMigration || invalidScheduledDate || (cutoverMode === 'now' && cutoverHighRisk && !cutoverRiskAccepted)) return;
    const cutover = cutoverMode === 'now' ? new Date().toISOString() : scheduledDate?.toISOString();
    if (!cutover) return;
    setTaskOperationNotice(undefined);
    if (cutoverMode === 'now') setPendingPlanAction({ kind: 'cutover', requestedAt: Date.now() });
    patchMigration.mutate(
      { name: latestMigration.metadata.name, patch: { spec: { cutover } } },
      {
        onSuccess: () => { setCutoverOpen(false); appendPlanAction(plan.metadata.name, cutoverMode === 'now' ? '立即执行业务割接' : '设置业务割接时间', cutover).catch(() => undefined); },
        onError: () => setPendingPlanAction(undefined),
      },
    );
  };
  const clearCutover = () => {
    if (!latestMigration) return;
    setPendingPlanAction({ kind: 'clear-cutover', requestedAt: Date.now() });
    patchMigration.mutate(
      { name: latestMigration.metadata.name, patch: { spec: { cutover: null } } },
      {
        onSuccess: () => { setCutoverOpen(false); appendPlanAction(plan.metadata.name, '取消业务割接预约').catch(() => undefined); },
        onError: () => setPendingPlanAction(undefined),
      },
    );
  };

  return <>
    <Link className="detail-back-link" to="/plans"><ArrowLeft size={16} />返回迁移任务</Link>
    <section className="detail-header">
      <div className="detail-title"><div><h2>{plan.metadata.name}</h2><p>{plan.spec.description || '无描述'}</p></div><div className="page-actions">
        {isPlanEditable(plan) && <Link className="button button-secondary" to={`/plans/${plan.metadata.name}/edit`}><Pencil size={16} />编辑任务</Link>}
        {pendingPlanAction?.kind === 'start'
          ? <Button icon={<RefreshCw className="spin" size={16} />} disabled>正在启动任务</Button>
          : planReady && <Button icon={<Play size={16} />} onClick={() => setConfirmAction({ kind: 'start' })} disabled={createMigration.isPending}>开始迁移</Button>}
        {status.tone === 'running' && migrationType === 'warm' && (immediateCutoverRequested
          ? <Button icon={<RefreshCw className="spin" size={16} />} disabled>正在关闭源虚拟机</Button>
          : cutoverInProgress
            ? <Button icon={<RefreshCw className="spin" size={16} />} disabled>业务割接中</Button>
            : <Button icon={<Clock3 size={16} />} onClick={openCutover} disabled={!latestMigration || migrations.isLoading || patchMigration.isPending}>{scheduledCutover ? '修改割接时间' : '设置割接时间'}</Button>)}
        {status.tone === 'running' && <Button variant="danger" icon={wholeTaskCancelRequested ? <RefreshCw className="spin" size={16} /> : <Pause size={16} />} onClick={() => setConfirmAction({ kind: 'cancel' })} disabled={!latestMigration || patchMigration.isPending || wholeTaskCancelRequested}>{wholeTaskCancelRequested ? '正在取消任务' : '取消整个任务'}</Button>}
        {status.tone === 'danger' && planReady && <><Button variant="secondary" icon={<RotateCcw size={16} />} onClick={() => setConfirmAction({ kind: 'start' })} disabled={createMigration.isPending}>重新执行全部</Button><Button title="无需重新复制已完成的磁盘数据，仅重试系统和驱动适配阶段" icon={<RefreshCw size={16} />} onClick={() => setConfirmAction({ kind: 'start', resumeConversion: true })} disabled={createMigration.isPending}>只重试系统适配</Button></>}
        {canRollback && <Button variant="danger" icon={<Undo2 size={16} />} onClick={() => { rollback.reset(); setRollbackConfirmed(false); setRollbackOpen(true); }}>一键回滚</Button>}
      </div></div>
      <div className="detail-meta"><div><span>状态</span><StatusBadge tone={displayStatus.tone}>{displayStatus.label}</StatusBadge></div><div><span>迁移类型</span><strong>{getMigrationTypeLabel(migrationType)}</strong></div><div><span>迁移路径</span><strong>{plan.spec.provider.source.name} → {plan.spec.provider.destination.name}</strong></div><div><span>目标资源空间</span><strong>{plan.spec.targetNamespace}</strong></div><div><span>开始时间</span><strong>{formatDate(plan.status?.migration?.started)}</strong></div></div>
    </section>

    {showAutoStartState && autoStartStatus === 'queued' && !planReady && <Alert tone="info" title="正在等待任务就绪">{autoStartMessage || '网络、存储和任务检查通过后将自动开始迁移，关闭当前页面不会影响启动。'}</Alert>}
    {showAutoStartState && autoStartStatus === 'failed' && !planReady && <Alert tone="danger" title="自动启动未完成"><div className="alert-action-row"><span>{autoStartMessage || '请修正网络、存储或任务检查问题后重新尝试。'}</span><Button variant="secondary" icon={retryAutoStart.isPending ? <RefreshCw className="spin" size={15} /> : <Play size={15} />} disabled={retryAutoStart.isPending} onClick={() => retryAutoStart.mutate(plan)}>{retryAutoStart.isPending ? '正在重新等待...' : '重新等待并启动'}</Button></div></Alert>}
    {showAutoStartState && autoStartStatus === 'failed' && planReady && <Alert tone="success" title="任务检查已恢复">此前发现的问题已经解除，当前任务可以开始迁移。</Alert>}
    {retryAutoStart.error && <Alert tone="danger" title="重新启动请求失败">{retryAutoStart.error.message}</Alert>}
    {immediateCutoverRequested && <Alert tone="warning" title="正在关闭源虚拟机">业务割接请求已受理，正在等待源虚拟机安全关机；关机完成后将自动进入最终增量同步，请勿重复操作。</Alert>}
    {!immediateCutoverRequested && cutoverInProgress && <Alert tone="info" title="业务割接进行中">源虚拟机已进入停机切换，正在同步最后的磁盘变化，进度可在下方虚拟机流水线中查看。</Alert>}
    {scheduledCutover && status.tone === 'running' && Date.parse(scheduledCutover) > currentTime && <Alert tone="info" title="业务割接已安排">将在 {formatDate(scheduledCutover)} 开始增量同步并关闭源虚拟机。可通过“修改割接时间”调整或取消。</Alert>}
    {wholeTaskCancelRequested && <Alert tone="warning" title="正在取消迁移任务">取消请求已受理，正在停止仍在执行的虚拟机迁移和数据传输。</Alert>}
    {taskOperationNotice && <Alert tone={taskOperationNotice.tone} title={taskOperationNotice.title}>{taskOperationNotice.message}</Alert>}
    {rollbackSummary && <Alert tone="info" title="回滚清理已提交">{rollbackSummary}</Alert>}
    {createMigration.error && !confirmAction && <Alert tone="danger" title="迁移启动失败">{createMigration.error.message}</Alert>}
    {patchMigration.error && !cutoverOpen && <Alert tone="danger" title="迁移操作失败">{patchMigration.error.message}</Alert>}
    {failed.length > 0 && <div id="failed-vms" className="anchor-target"><Alert tone="danger" title={`${failed.length} 台虚拟机迁移失败`}><div className="alert-action-row"><span>失败阶段、排障建议与技术信息已在下方展开。可以只为失败虚拟机创建独立重试任务，不影响本批次已完成的虚拟机。</span><Button variant="secondary" disabled={createRetryPlan.isPending} onClick={() => setConfirmAction({ kind: 'retry' })}>{createRetryPlan.isPending ? '正在创建...' : `创建失败项重试任务（${failed.length} 台）`}</Button></div></Alert></div>}
    {createRetryPlan.error && <Alert tone="danger" title="创建重试任务失败">{createRetryPlan.error.message}</Alert>}
    <div className="metric-grid" style={{ marginTop: 17 }}>
      <div className="metric"><div className="metric-header"><span>任务内虚拟机</span></div><div className="metric-value"><strong>{plan.spec.vms.length}</strong><span>台</span></div></div>
      <div className="metric"><div className="metric-header"><span>已完成</span></div><div className="metric-value"><strong>{completed}</strong><span>台</span></div></div>
      <div className="metric metric-danger"><div className="metric-header"><span>失败</span></div><div className="metric-value"><strong>{failed.length}</strong><span>台</span></div></div>
      <div className="metric"><div className="metric-header"><span>{allVmsComplete ? '任务完成情况' : '总体磁盘复制'}</span></div>{allVmsComplete ? <div className="metric-value"><strong>{completed}</strong><span>台虚拟机已完成全部迁移步骤</span></div> : <ProgressBar value={aggregateCopy} label="全部虚拟机" tone={copyFailed ? 'danger' : copyComplete ? 'success' : 'normal'} />}</div>
    </div>
    <div className="detail-refresh-note">状态每 5 秒自动刷新 · 最近获取 {plans.dataUpdatedAt ? formatDate(new Date(plans.dataUpdatedAt).toISOString()) : '-'}</div>

    <details className="panel task-config-panel">
      <summary>查看任务配置与风险选项</summary>
      <div className="review-list">
        <div className="review-row"><span>网络配置</span><strong>{plan.spec.map.network.name}</strong></div>
        <div className="review-row"><span>存储配置</span><strong>{plan.spec.map.storage.name}</strong></div>
        <div className="review-row"><span>目标驱动适配</span><strong>{plan.spec.skipGuestConversion ? '关闭（原样复制磁盘）' : '开启'}</strong></div>
        <div className="review-row"><span>迁移前系统与磁盘检查</span><strong>{plan.spec.runPreflightInspection ? '开启' : '关闭（风险）'}</strong></div>
        <div className="review-row"><span>静态地址处理</span><strong>{plan.spec.preserveStaticIPs === false ? '不保留' : '尝试保留'}</strong></div>
        <div className="review-row"><span>迁移后电源状态</span><strong>{plan.spec.targetPowerState === 'on' ? '开机' : plan.spec.targetPowerState === 'off' ? '关机' : '跟随源虚拟机'}</strong></div>
      </div>
    </details>

    {((plan.status?.migration?.history || []).length > 0 || actionHistory.length > 0) && <details className="panel task-history-panel">
      <summary>查看执行与操作记录（{(plan.status?.migration?.history?.length || 0) + actionHistory.length} 条）</summary>
      {(plan.status?.migration?.history || []).length > 0 && <><h4>后端执行记录</h4><div className="history-list">{(plan.status?.migration?.history || []).slice().reverse().map((item, index) => <div key={`${item.migration?.uid || item.migration?.name}-${index}`}><strong>{item.migration?.name || `第 ${(plan.status?.migration?.history?.length || 0) - index} 次执行`}</strong><span>开始 {formatDate(item.started)} · {item.completed ? `完成 ${formatDate(item.completed)}` : '尚未结束'}</span></div>)}</div></>}
      {actionHistory.length > 0 && <><h4>控制台操作记录</h4><div className="history-list">{actionHistory.slice().reverse().map((item, index) => <div key={`${item.at}-${index}`}><strong>{item.action}</strong><span>{formatDate(item.at)}{item.detail ? ` · ${item.detail}` : ''}</span></div>)}</div></>}
    </details>}

    <div className="vm-status-tabs" role="tablist" aria-label="按迁移状态筛选虚拟机">
      {([
        ['all', '全部'], ['running', '进行中'], ['waiting', '等待割接'], ['failed', '失败'], ['completed', '已完成'],
      ] as Array<[VMFilter, string]>).map(([value, label]) => <button type="button" role="tab" aria-selected={vmFilter === value} className={vmFilter === value ? 'active' : ''} key={value} onClick={() => setVmFilter(value)}>{label} <span>{vmCounts[value]}</span></button>)}
    </div>
    <div className="vm-detail-list">
      {vms.length === 0 && <section className="panel"><PageState empty emptyText={status.tone === 'running' ? '迁移任务已提交，正在等待虚拟机进入执行队列。' : '该任务尚未执行，暂无迁移进度。'} /></section>}
      {vms.length > 0 && filteredVMs.length === 0 && <section className="panel"><PageState empty emptyText="当前状态下没有虚拟机。" /></section>}
      {filteredVMs.map((vm, vmIndex) => {
        const failure = getVmFailure(vm);
        const copy = getCurrentDiskTransferStep(vm);
        const vmCopyFailed = Boolean(copy && getStepFailure(copy).length > 0);
        const vmCopyComplete = Boolean(copy && isDiskTransferComplete(vm, copy));
        const vmCompleted = Boolean((vm.completed || /Completed|Succeeded/i.test(vm.phase || '')) && !failure);
        return <details className="vm-detail" key={vm.id} open={Boolean(failure) || (!vmCompleted && vmIndex === 0)}>
          <summary><div><strong>{vm.name || vm.id}</strong><small>{getMigrationPhaseLabel(vm.phase)}</small></div>{vmCompleted ? <div className="vm-copy-summary success"><strong>全部迁移步骤已完成</strong></div> : <div className={`vm-copy-summary ${vmCopyFailed ? 'danger' : vmCopyComplete ? 'success' : ''}`}><span>{copy ? getMigrationStepLabel(copy) : '等待磁盘传输'}</span><strong>{diskTransferProgressPercent(vm, copy)}%</strong></div>}<StatusBadge tone={failure ? 'danger' : vmCompleted ? 'success' : vmFilterState(vm, migrationType) === 'waiting' ? 'warning' : 'running'}>{failure ? '失败' : vmCompleted ? '完成' : vmFilterState(vm, migrationType) === 'waiting' ? '等待割接' : '执行中'}</StatusBadge></summary>
          <div className="vm-detail-body">
            <div className="vm-detail-actions">
              {status.tone === 'running' && (() => {
                const vmCancelRequested = pendingPlanAction?.kind === 'cancel-vm' && pendingPlanAction.vmId === vm.id
                  || Boolean(latestMigration?.spec.cancel?.some((item) => item.id === vm.id) && !vm.completed && !/Canceled|Cancelled|Completed|Succeeded/i.test(vm.phase || ''));
                return <Button variant="secondary" icon={vmCancelRequested ? <RefreshCw className="spin" size={15} /> : undefined} disabled={!latestMigration || patchMigration.isPending || vmCancelRequested} onClick={() => setConfirmAction({ kind: 'cancel-vm', vmId: vm.id })}>{vmCancelRequested ? '取消中' : '只取消此虚拟机'}</Button>;
              })()}
              {failure && <Button variant="secondary" disabled={createRetryPlan.isPending} onClick={() => { setConfirmAction({ kind: 'retry', vmId: vm.id }); }}>为此虚拟机创建重试任务</Button>}
            </div>
            {failure && <div className="failure-box"><strong>失败阶段：{getMigrationStepLabel(failure.stage)}</strong><ul><ErrorGuidance reasons={failure.reasons} /></ul></div>}
            <div className="pipeline" style={{ marginTop: failure ? 16 : 0 }}>{(vm.pipeline || []).map((step, stepIndex) => {
              const reasons = getStepFailure(step);
              const isCopy = isDiskTransferStep(step);
              const effectiveComplete = isCopy ? isDiskTransferComplete(vm, step) : isStepComplete(step);
              const tone = stepTone(step, effectiveComplete);
              const stageName = getMigrationStepLabel(step);
              return <div className="pipeline-step" key={`${step.name}-${stepIndex}`}>
                <div className={`step-icon ${tone}`}>{tone === 'success' ? <Check size={14} /> : tone === 'danger' ? <X size={14} /> : tone === 'running' ? <RefreshCw className="spin" size={13} /> : <Circle size={11} />}</div>
                <div className="step-name"><strong>{stageName}</strong><small>{effectiveComplete ? '已完成' : getMigrationPhaseLabel(step.phase)}</small></div>
                <div className="step-content">
                  {isCopy && !effectiveComplete && step.tasks && step.tasks.length > 0 ? <div className="disk-progress-list">
                    <div className="copy-total"><span>{stageName}总进度</span><strong>{stepProgressPercent(step, effectiveComplete)}%</strong></div>
                    <TransferMetrics step={step} fallbackStarted={vm.started} complete={effectiveComplete} />
                    {step.tasks.map((task, taskIndex) => {
                      const taskFailed = Boolean(task.error?.reasons?.length);
                      const taskComplete = !taskFailed && (effectiveComplete || isStepComplete(task));
                      const taskLabel = getMigrationTaskLabel(task);
                      return <div className="task-row" key={`${task.name}-${taskIndex}`}><span title={taskLabel}>{taskLabel}</span><ProgressBar value={stepProgressPercent(task, taskComplete)} tone={taskFailed ? 'danger' : taskComplete ? 'success' : 'normal'} /></div>;
                    })}
                  </div> : isCopy && !effectiveComplete ? <><ProgressBar value={stepProgressPercent(step, effectiveComplete)} label={stageName} tone={tone === 'danger' ? 'danger' : 'normal'} /><TransferMetrics step={step} fallbackStarted={vm.started} complete={effectiveComplete} /></> : null}
                  {reasons.length > 0 && !failure && <div className="failure-box"><strong>{stageName}失败</strong><ul><ErrorGuidance reasons={reasons} /></ul></div>}
                </div>
              </div>;
            })}</div>
          </div>
        </details>;
      })}
    </div>

    <Modal
      open={cutoverOpen}
      onClose={closeCutover}
      title={scheduledCutover ? '修改割接时间' : '设置割接时间'}
      description="业务割接（停机切换）开始时会关闭源虚拟机，请选择合适的业务窗口。"
      footer={<>
        {scheduledCutover && <Button variant="danger" onClick={clearCutover} disabled={patchMigration.isPending}>取消预约</Button>}
        <Button variant="secondary" onClick={closeCutover}>关闭</Button>
        <Button onClick={saveCutover} disabled={patchMigration.isPending || invalidScheduledDate || (cutoverMode === 'now' && cutoverHighRisk && !cutoverRiskAccepted)}>{patchMigration.isPending ? '正在保存...' : cutoverMode === 'now' ? '立即执行业务割接' : '保存割接安排'}</Button>
      </>}
    >
      <div className="segmented-control" role="group" aria-label="业务割接执行时间">
        <button className={cutoverMode === 'now' ? 'active' : ''} onClick={() => setCutoverMode('now')}>立即执行</button>
        <button className={cutoverMode === 'scheduled' ? 'active' : ''} onClick={() => setCutoverMode('scheduled')}>预约时间</button>
      </div>
      {cutoverMode === 'now'
        ? <><Alert tone="warning" title="即将开始业务割接（停机切换）">确认后将立即关闭源虚拟机，并同步最后的磁盘变化。</Alert>{cutoverHighRisk && <div className="cutover-risk-gate"><Alert tone="warning" title="高危预警">至少一台虚拟机的基础数据同步尚未达到 95%（当前最低进度：{baseCopyPercent}%）。此时强行割接将导致源虚拟机立即关机，剩余数据必须在业务停机窗口内传输，可能造成较长中断。</Alert><label><input type="checkbox" checked={cutoverRiskAccepted} onChange={(event) => setCutoverRiskAccepted(event.target.checked)} />已知晓非就绪割接风险</label></div>}</>
        : <div className="cutover-schedule"><Field label="预约执行时间" required help="请使用控制台所在设备的本地时间。"><input type="datetime-local" value={cutoverAt} min={minimumCutoverAt} onChange={(event) => setCutoverAt(event.target.value)} /></Field>{invalidScheduledDate && <small className="field-error">请选择未来的时间。</small>}</div>}
      {patchMigration.error && <Alert tone="danger" title="割接时间设置失败">{patchMigration.error.message}</Alert>}
    </Modal>
    <Modal
      open={rollbackOpen}
      onClose={() => !rollback.isPending && setRollbackOpen(false)}
      title="确认一键回滚"
      description={`回滚会终止当前迁移，并清理任务 ${plan.metadata.name} 在目标资源空间 ${plan.spec.targetNamespace} 中创建的全部虚拟机及磁盘资源。源端虚拟机不会被删除。`}
      footer={<><Button variant="secondary" disabled={rollback.isPending} onClick={() => setRollbackOpen(false)}>取消</Button><Button variant="danger" icon={rollback.isPending ? <RefreshCw className="spin" size={16} /> : <Undo2 size={16} />} disabled={!rollbackConfirmed || rollback.isPending} onClick={() => rollback.mutate({ targetPlan: plan, migration: latestMigration })}>{rollback.isPending ? '正在回滚...' : '确认回滚'}</Button></>}
    >
      <ol className="rollback-actions">
        <li>停止目标集群中仍在运行的数据导入与传输任务。</li>
        <li>清理本任务创建的目标虚拟机、目标磁盘和临时数据。</li>
        <li>取消当前迁移，保留源端虚拟机及其原始数据。</li>
      </ol>
      <Alert tone="warning" title="请核对清理范围">本任务包含 {plan.spec.vms.length} 台虚拟机：{plan.spec.vms.map((vm) => vm.name || vm.id).join('、')}。如果该任务曾多次执行，历史执行创建且仍带有本任务标识的资源也会被清理。</Alert>
      <label className="rollback-confirm"><input type="checkbox" checked={rollbackConfirmed} onChange={(event) => setRollbackConfirmed(event.target.checked)} /><span><strong>我已确认回滚范围</strong><small>只会清理带有当前任务资源标识的对象。</small></span></label>
      {rollback.error && <div style={{ marginTop: 14 }}><Alert tone="danger" title="回滚失败">{rollback.error.message}</Alert></div>}
    </Modal>
    <ConfirmDialog
      open={Boolean(confirmAction)}
      title={confirmAction?.kind === 'cancel' ? '取消整个迁移任务' : confirmAction?.kind === 'cancel-vm' ? '取消单台虚拟机迁移' : confirmAction?.kind === 'retry' ? '创建独立重试任务' : '开始迁移任务'}
      description={confirmAction?.kind === 'cancel'
        ? `将取消任务中的全部 ${plan.spec.vms.length} 台虚拟机，已完成的数据不会自动清理。`
        : confirmAction?.kind === 'cancel-vm'
          ? `只取消虚拟机 ${vms.find((vm) => vm.id === confirmAction.vmId)?.name || confirmAction?.vmId || ''}，同批次其他虚拟机继续执行。`
          : confirmAction?.kind === 'retry'
            ? `将复用当前网络与存储配置，创建一个只包含${confirmAction.vmId ? '该虚拟机' : `失败的 ${failed.length} 台虚拟机`}的新任务，并进入编辑页面供再次核对。`
            : `将执行任务 ${plan.metadata.name}。冷迁移会关闭源虚拟机，温迁移将在后续业务割接时停机。`}
      confirmLabel={confirmAction?.kind === 'cancel' || confirmAction?.kind === 'cancel-vm' ? '确认取消' : confirmAction?.kind === 'retry' ? '创建重试任务' : '确认开始'}
      danger={confirmAction?.kind === 'cancel' || confirmAction?.kind === 'cancel-vm'}
      pending={patchMigration.isPending || createMigration.isPending || createRetryPlan.isPending}
      pendingLabel={confirmAction?.kind === 'cancel' ? '正在提交取消...' : confirmAction?.kind === 'cancel-vm' ? '正在取消虚拟机...' : confirmAction?.kind === 'retry' ? '正在创建重试任务...' : '正在启动任务...'}
      error={patchMigration.error || createMigration.error || createRetryPlan.error}
      onClose={() => setConfirmAction(undefined)}
      onConfirm={() => {
        if (!confirmAction) return;
        if (confirmAction.kind === 'cancel') cancel();
        else if (confirmAction.kind === 'cancel-vm') cancel(confirmAction.vmId);
        else if (confirmAction.kind === 'retry') createFocusedRetry(confirmAction.vmId ? [confirmAction.vmId] : undefined);
        else start(confirmAction.resumeConversion);
      }}
    />
  </>;
}
