import { useState } from 'react';
import { Check, Circle, Clock3, Pause, Pencil, Play, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useCreateResource, useMigrations, usePatchResource, usePlans } from '../api/hooks';
import { buildMigration } from '../domain/builders';
import {
  getCurrentDiskTransferStep,
  diskTransferProgressPercent,
  getLatestMigration,
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
import type { Migration, MigrationStep, VMStatus } from '../domain/types';
import { Alert, Button, Field, Modal, PageState, ProgressBar, StatusBadge, formatDate } from '../components/ui';

function stepTone(step: MigrationStep, complete = isStepComplete(step)) {
  if (getStepFailure(step).length) return 'danger';
  if (complete) return 'success';
  if (/Running|Progress|Copying|Import/i.test(step.phase || '')) return 'running';
  return 'pending';
}

function displayStageName(value?: string) {
  if (!value) return '未知阶段';
  if (/Cutover|Finalize disk transfer|完成磁盘传输/i.test(value)) return '完成磁盘传输';
  if (/DiskTransfer|Copy disk|复制磁盘/i.test(value)) return '复制磁盘';
  if (/Conversion|virt-v2v|系统适配/i.test(value)) return '系统适配';
  if (/CreateVM|创建目标/i.test(value)) return '创建目标虚拟机';
  if (/Initialize|Prepare|准备/i.test(value)) return '准备迁移';
  return value;
}

function displayPhase(value?: string) {
  if (!value) return '等待中';
  if (/Completed|Succeeded/i.test(value)) return '已完成';
  if (/Failed|Error/i.test(value)) return '失败';
  if (/Running|Progress|Copying|Executing|Import/i.test(value)) return '进行中';
  if (/Pending/i.test(value)) return '等待中';
  return value;
}

function toLocalDateTime(value?: string, offsetMinutes = 60) {
  const date = value ? new Date(value) : new Date(Date.now() + offsetMinutes * 60_000);
  const validDate = Number.isNaN(date.getTime()) ? new Date(Date.now() + offsetMinutes * 60_000) : date;
  return new Date(validDate.getTime() - validDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function PlanDetailPage() {
  const { name } = useParams();
  const plans = usePlans();
  const migrations = useMigrations();
  const createMigration = useCreateResource<Migration>('migrations');
  const patchMigration = usePatchResource<Migration>('migrations');
  const [cutoverOpen, setCutoverOpen] = useState(false);
  const [cutoverMode, setCutoverMode] = useState<'now' | 'scheduled'>('now');
  const [cutoverAt, setCutoverAt] = useState(() => toLocalDateTime());
  const [minimumCutoverAt, setMinimumCutoverAt] = useState(() => toLocalDateTime(undefined, 0));
  const plan = plans.data?.items.find((item) => item.metadata.name === name);

  if (plans.isLoading) return <PageState loading />;
  if (!plan) return <Alert tone="danger" title="计划不存在">无法找到迁移计划 {name}。<div style={{ marginTop: 8 }}><Link to="/plans">返回列表</Link></div></Alert>;

  const status = getPlanStatus(plan);
  const migrationType = getPlanMigrationType(plan);
  const planReady = isPlanReady(plan);
  const latestMigration = getLatestMigration(plan, migrations.data?.items || []);
  const scheduledCutover = latestMigration?.spec.cutover;
  const vms = plan.status?.migration?.vms || [];
  const failed = vms.filter((vm) => getVmFailure(vm));
  const completed = vms.filter((vm) => vm.completed && !getVmFailure(vm)).length;
  const copyEntries = vms.map((vm) => ({ vm, step: getCurrentDiskTransferStep(vm) })).filter((entry) => Boolean(entry.step)) as Array<{ vm: VMStatus; step: MigrationStep }>;
  const aggregateCopy = copyEntries.length ? Math.round(copyEntries.reduce((sum, entry) => sum + diskTransferProgressPercent(entry.vm, entry.step), 0) / copyEntries.length) : 0;
  const copyFailed = copyEntries.some(({ step }) => getStepFailure(step).length > 0);
  const copyComplete = copyEntries.length > 0 && copyEntries.every(({ vm, step }) => isDiskTransferComplete(vm, step));
  const scheduledDate = cutoverMode === 'scheduled' ? new Date(cutoverAt) : undefined;
  const invalidScheduledDate = cutoverMode === 'scheduled'
    && (!cutoverAt || Number.isNaN(scheduledDate?.getTime()) || Date.parse(cutoverAt) <= Date.parse(minimumCutoverAt));

  const start = (resumeConversion = false) => {
    if (!planReady) return;
    createMigration.mutate(buildMigration(plan, { resumeConversion }));
  };
  const cancel = () => {
    if (!latestMigration) return;
    patchMigration.mutate({ name: latestMigration.metadata.name, patch: { spec: { cancel: plan.spec.vms.map((vm) => ({ id: vm.id })) } } });
  };
  const openCutover = () => {
    const currentLocalTime = toLocalDateTime(undefined, 0);
    const hasFutureSchedule = Boolean(scheduledCutover && new Date(scheduledCutover).getTime() > Date.parse(currentLocalTime));
    setCutoverMode(hasFutureSchedule ? 'scheduled' : 'now');
    setCutoverAt(toLocalDateTime(scheduledCutover || undefined));
    setMinimumCutoverAt(currentLocalTime);
    patchMigration.reset();
    setCutoverOpen(true);
  };
  const closeCutover = () => {
    setCutoverOpen(false);
    patchMigration.reset();
  };
  const saveCutover = () => {
    if (!latestMigration || invalidScheduledDate) return;
    const cutover = cutoverMode === 'now' ? new Date().toISOString() : scheduledDate?.toISOString();
    if (!cutover) return;
    patchMigration.mutate(
      { name: latestMigration.metadata.name, patch: { spec: { cutover } } },
      { onSuccess: () => setCutoverOpen(false) },
    );
  };
  const clearCutover = () => {
    if (!latestMigration) return;
    patchMigration.mutate(
      { name: latestMigration.metadata.name, patch: { spec: { cutover: null } } },
      { onSuccess: () => setCutoverOpen(false) },
    );
  };

  return <>
    <section className="detail-header">
      <div className="detail-title"><div><h2>{plan.metadata.name}</h2><p>{plan.spec.description || '无描述'}</p></div><div className="page-actions">
        {isPlanEditable(plan) && <Link className="button button-secondary" to={`/plans/${plan.metadata.name}/edit`}><Pencil size={16} />编辑计划</Link>}
        {planReady && <Button icon={<Play size={16} />} onClick={() => start()} disabled={createMigration.isPending}>开始迁移</Button>}
        {status.tone === 'running' && migrationType === 'warm' && <Button icon={<Clock3 size={16} />} onClick={openCutover} disabled={!latestMigration || migrations.isLoading}>{scheduledCutover ? '修改 Cutover' : '设置 Cutover'}</Button>}
        {status.tone === 'running' && <Button variant="danger" icon={<Pause size={16} />} onClick={cancel} disabled={!latestMigration || patchMigration.isPending}>取消迁移</Button>}
        {status.tone === 'danger' && planReady && <><Button variant="secondary" icon={<RotateCcw size={16} />} onClick={() => start()} disabled={createMigration.isPending}>重新执行</Button><Button icon={<RefreshCw size={16} />} onClick={() => start(true)} disabled={createMigration.isPending}>仅恢复系统适配</Button></>}
      </div></div>
      <div className="detail-meta"><div><span>状态</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div><div><span>迁移类型</span><strong>{migrationType.toUpperCase()}</strong></div><div><span>迁移路径</span><strong>{plan.spec.provider.source.name} → {plan.spec.provider.destination.name}</strong></div><div><span>目标命名空间</span><strong>{plan.spec.targetNamespace}</strong></div><div><span>开始时间</span><strong>{formatDate(plan.status?.migration?.started)}</strong></div></div>
    </section>

    {scheduledCutover && status.tone === 'running' && <Alert tone="info" title="Cutover 已安排">将在 {formatDate(scheduledCutover)} 开始最终磁盘同步并关闭源虚拟机。可通过“修改 Cutover”调整或取消。</Alert>}
    {createMigration.error && <Alert tone="danger" title="迁移启动失败">{createMigration.error.message}</Alert>}
    {patchMigration.error && !cutoverOpen && <Alert tone="danger" title="迁移操作失败">{patchMigration.error.message}</Alert>}
    {failed.length > 0 && <div id="failed-vms" className="anchor-target"><Alert tone="danger" title={`${failed.length} 台虚拟机迁移失败`}>失败阶段与系统返回的原始原因已在下方展开。修复后可重新执行；如果磁盘复制已经完成，可选择“仅恢复系统适配”。</Alert></div>}
    <div className="metric-grid" style={{ marginTop: 17 }}>
      <div className="metric"><div className="metric-header"><span>计划内 VM</span></div><div className="metric-value"><strong>{plan.spec.vms.length}</strong><span>台</span></div></div>
      <div className="metric"><div className="metric-header"><span>已完成</span></div><div className="metric-value"><strong>{completed}</strong><span>台</span></div></div>
      <div className="metric metric-danger"><div className="metric-header"><span>失败</span></div><div className="metric-value"><strong>{failed.length}</strong><span>台</span></div></div>
      <div className="metric"><div className="metric-header"><span>总体磁盘复制</span></div><ProgressBar value={aggregateCopy} label="全部虚拟机" tone={copyFailed ? 'danger' : copyComplete ? 'success' : 'normal'} /></div>
    </div>

    <section className="panel" style={{ marginBottom: 17 }}><div className="panel-header"><h3>计划配置</h3></div><div className="risk-summary"><div><strong>{plan.spec.skipGuestConversion ? '关闭' : '启用'}</strong><span>系统适配</span></div><div><strong>{plan.spec.runPreflightInspection ? '启用' : '关闭'}</strong><span>迁移前检查</span></div><div><strong>{plan.spec.map.storage.name}</strong><span>存储映射</span></div></div></section>

    <div className="vm-detail-list">
      {vms.length === 0 && <section className="panel"><PageState empty emptyText="该计划尚未执行，暂无迁移进度。" /></section>}
      {vms.map((vm, vmIndex) => {
        const failure = getVmFailure(vm);
        const copy = getCurrentDiskTransferStep(vm);
        const vmCopyFailed = Boolean(copy && getStepFailure(copy).length > 0);
        const vmCopyComplete = Boolean(copy && isDiskTransferComplete(vm, copy));
        return <details className="vm-detail" key={vm.id} open={Boolean(failure) || vmIndex === 0}>
          <summary><div><strong>{vm.name || vm.id}</strong><small>{displayPhase(vm.phase)}</small></div><div className={`vm-copy-summary ${vmCopyFailed ? 'danger' : vmCopyComplete ? 'success' : ''}`}><span>{copy && /Cutover/i.test(copy.name) ? '最终同步' : '磁盘复制'}</span><strong>{diskTransferProgressPercent(vm, copy)}%</strong></div><StatusBadge tone={failure ? 'danger' : vm.completed ? 'success' : 'running'}>{failure ? '失败' : vm.completed ? '完成' : '执行中'}</StatusBadge></summary>
          <div className="vm-detail-body">
            {failure && <div className="failure-box"><strong>失败阶段：{displayStageName(failure.stage)}</strong><ul>{failure.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
            <div className="pipeline" style={{ marginTop: failure ? 16 : 0 }}>{(vm.pipeline || []).map((step) => {
              const reasons = getStepFailure(step);
              const isCopy = isDiskTransferStep(step);
              const effectiveComplete = isCopy ? isDiskTransferComplete(vm, step) : isStepComplete(step);
              const tone = stepTone(step, effectiveComplete);
              const stageName = displayStageName(step.description || step.name);
              return <div className="pipeline-step" key={step.name}>
                <div className={`step-icon ${tone}`}>{tone === 'success' ? <Check size={14} /> : tone === 'danger' ? <X size={14} /> : tone === 'running' ? <RefreshCw className="spin" size={13} /> : <Circle size={11} />}</div>
                <div className="step-name"><strong>{stageName}</strong><small>{effectiveComplete ? '已完成' : displayPhase(step.phase)}</small></div>
                <div className="step-content">
                  {isCopy && step.tasks && step.tasks.length > 0 ? <div className="disk-progress-list">
                    <div className="copy-total"><span>{stageName}总进度</span><strong>{stepProgressPercent(step, effectiveComplete)}%</strong></div>
                    {step.tasks.map((task) => {
                      const taskFailed = Boolean(task.error?.reasons?.length);
                      const taskComplete = !taskFailed && (effectiveComplete || isStepComplete(task));
                      return <div className="task-row" key={task.name}><span>{task.description || task.name}</span><ProgressBar value={stepProgressPercent(task, taskComplete)} tone={taskFailed ? 'danger' : taskComplete ? 'success' : 'normal'} /></div>;
                    })}
                  </div> : isCopy ? <ProgressBar value={stepProgressPercent(step, effectiveComplete)} label={stageName} tone={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'normal'} /> : null}
                  {reasons.length > 0 && !failure && <div className="failure-box"><strong>{stageName}失败</strong><ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
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
      title={scheduledCutover ? '修改 Cutover' : '设置 Cutover'}
      description="最终同步开始时会关闭源虚拟机，请选择合适的业务窗口。"
      footer={<>
        {scheduledCutover && <Button variant="danger" onClick={clearCutover} disabled={patchMigration.isPending}>取消计划</Button>}
        <Button variant="secondary" onClick={closeCutover}>关闭</Button>
        <Button onClick={saveCutover} disabled={patchMigration.isPending || invalidScheduledDate}>{patchMigration.isPending ? '正在保存...' : cutoverMode === 'now' ? '立即执行' : '保存计划'}</Button>
      </>}
    >
      <div className="segmented-control" role="group" aria-label="Cutover 执行时间">
        <button className={cutoverMode === 'now' ? 'active' : ''} onClick={() => setCutoverMode('now')}>立即执行</button>
        <button className={cutoverMode === 'scheduled' ? 'active' : ''} onClick={() => setCutoverMode('scheduled')}>计划时间</button>
      </div>
      {cutoverMode === 'now'
        ? <Alert tone="warning" title="即将开始最终同步">确认后将立即关闭源虚拟机，并复制最后的磁盘变化。</Alert>
        : <div className="cutover-schedule"><Field label="计划执行时间" required help="请使用控制台所在设备的本地时间。"><input type="datetime-local" value={cutoverAt} min={minimumCutoverAt} onChange={(event) => setCutoverAt(event.target.value)} /></Field>{invalidScheduledDate && <small className="field-error">请选择未来的时间。</small>}</div>}
      {patchMigration.error && <Alert tone="danger" title="Cutover 设置失败">{patchMigration.error.message}</Alert>}
    </Modal>
  </>;
}
