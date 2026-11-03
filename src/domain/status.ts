import type { Condition, Migration, MigrationStep, MigrationTask, MigrationType, Plan, Progress, VMStatus } from './types';

export type UiStatus = 'ready' | 'running' | 'success' | 'warning' | 'danger' | 'pending' | 'archived';

const activeCondition = (conditions: Condition[] | undefined, type: string) =>
  conditions?.find((condition) => condition.type === type && condition.status === 'True');

const blockerCondition = (conditions: Condition[] | undefined) => conditions?.find(
  (condition) => condition.status === 'True' && ['Critical', 'Error'].includes(condition.category || ''),
);

export function getPlanMigrationType(plan: Plan): MigrationType {
  if (plan.spec.type && ['cold', 'warm', 'live', 'conversion'].includes(plan.spec.type)) return plan.spec.type;
  if (plan.spec.warm || plan.spec.vms.some((vm) => vm.warm === true)) return 'warm';
  return 'cold';
}

const migrationTypeLabels: Record<MigrationType, string> = {
  cold: '冷迁移',
  warm: '温迁移',
  live: '实时迁移',
  conversion: '系统转换',
};

export function getMigrationTypeLabel(type: MigrationType): string {
  return migrationTypeLabels[type];
}

export function isPlanReady(plan: Plan): boolean {
  const conditions = plan.status?.conditions;
  const generationIsCurrent = plan.metadata.generation === undefined
    || plan.status?.observedGeneration === plan.metadata.generation;
  return Boolean(
    generationIsCurrent
    && activeCondition(conditions, 'Ready')
    && !activeCondition(conditions, 'Executing')
    && !blockerCondition(conditions),
  );
}

export function isPlanEditable(plan: Plan): boolean {
  return !plan.spec.archived
    && !plan.status?.migration?.started
    && !activeCondition(plan.status?.conditions, 'Executing');
}

export function getPlanStatus(plan: Plan): { label: string; tone: UiStatus; reason?: string } {
  const rollbackStatus = plan.metadata.annotations?.['eis-dmt.io/rollback-status'];
  if (rollbackStatus === 'requested') return { label: '回滚处理中', tone: 'warning' };
  if (rollbackStatus === 'failed') return { label: '回滚失败', tone: 'danger', reason: plan.metadata.annotations?.['eis-dmt.io/rollback-message'] };
  if (rollbackStatus === 'completed') {
    return { label: '已回滚', tone: 'warning' };
  }
  const conditions = plan.status?.conditions;
  if (activeCondition(conditions, 'Failed')) {
    const failure = activeCondition(conditions, 'Failed');
    return { label: '失败', tone: 'danger', reason: failure?.message || failure?.reason };
  }
  if (activeCondition(conditions, 'Canceled')) return { label: '已取消', tone: 'warning' };
  if (activeCondition(conditions, 'Succeeded')) return { label: '已完成', tone: 'success' };
  if (activeCondition(conditions, 'Executing')) return { label: '迁移中', tone: 'running' };
  if (plan.spec.archived || activeCondition(conditions, 'Archived')) return { label: '已归档', tone: 'archived' };
  const blocker = blockerCondition(conditions);
  if (blocker) return { label: '已阻塞', tone: 'danger', reason: blocker.message || blocker.reason };
  if (isPlanReady(plan)) return { label: '可执行', tone: 'ready' };
  return { label: '准备中', tone: 'pending' };
}

/** Returns the newest known activity across the plan and all of its executions. */
export function getPlanActivityTime(plan: Plan): number {
  const migration = plan.status?.migration;
  const timestamps = [
    migration?.completed,
    migration?.started,
    ...(migration?.history || []).flatMap((item) => [item.completed, item.started]),
    plan.metadata.creationTimestamp,
  ];
  return Math.max(0, ...timestamps.map((value) => Date.parse(value || '')).filter(Number.isFinite));
}

export function progressPercent(progress?: Progress): number {
  if (!progress?.total || progress.total <= 0) return progress?.completed ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((progress.completed || 0) / progress.total * 100)));
}

export function isStepComplete(step: MigrationStep): boolean {
  return Boolean(step.completed || /Completed|Succeeded/i.test(step.phase || ''));
}

export function stepProgressPercent(step?: MigrationTask, forceComplete = false): number {
  if (!step) return 0;
  return forceComplete || Boolean(step.completed) || /Completed|Succeeded/i.test(step.phase || '')
    ? 100
    : progressPercent(step.progress);
}

const containsChinese = (value: string) => /[\u3400-\u9fff]/.test(value);

const migrationStepLabels: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /WaitForSnapshotConsolidation|final snapshot removal|snapshot.*consolidation/i, label: '等待源端合并磁盘快照' },
  { pattern: /Cutover|Finalize disk transfer|完成磁盘传输/i, label: '同步增量数据并关闭源虚拟机' },
  { pattern: /PreflightInspection|Inspect VM before migration/i, label: '检查源虚拟机迁移条件' },
  { pattern: /DiskAllocation|Allocate disks/i, label: '为目标磁盘分配空间' },
  { pattern: /Create EBS volumes and PVCs/i, label: '从源磁盘快照创建目标数据卷' },
  { pattern: /Create VolumeSnapshots and PVCs/i, label: '创建目标磁盘快照与数据卷' },
  { pattern: /ConvertOpenstackSnapshot|Convert OpenStack snapshot/i, label: '将源端磁盘快照转换为目标镜像' },
  { pattern: /DiskTransfer|DiskTransferV2v|CopyDisks|Copy disks|Transfer disks|复制磁盘/i, label: '复制虚拟机磁盘' },
  { pattern: /ImageConversion|Convert image to kubevirt|Convert guest operating system|Guest Conversion|virt-v2v|系统适配/i, label: '适配虚拟机操作系统与目标驱动' },
  { pattern: /WaitForGuestReboots|Windows guest reboot/i, label: '等待 Windows 虚拟机完成驱动安装重启' },
  { pattern: /VirtualMachineCreation|CreateVM|Create VM|Create VirtualMachine on target|创建目标虚拟机/i, label: '在目标集群创建虚拟机' },
  { pattern: /PrepareTarget|Prepare target namespace/i, label: '准备目标资源空间' },
  { pattern: /Synchronization|Synchronize source and target VMs/i, label: '同步源端与目标端虚拟机运行状态' },
  { pattern: /PrepareSource|Stop source EC2 instance|Deallocate source Azure VM|Pre-snapshot and deallocate source Azure VM/i, label: '停止源端云主机并保护磁盘数据' },
  { pattern: /CreateSnapshots|Create EBS volume snapshots|Create Azure managed disk snapshots/i, label: '为源虚拟机创建磁盘快照' },
  { pattern: /ShareSnapshots|Share EBS snapshots with target account/i, label: '向目标环境共享源磁盘快照' },
  { pattern: /Cleanup|Clean up EBS snapshots/i, label: '清理迁移产生的临时快照' },
  { pattern: /PreHook|pre-migration hook/i, label: '执行虚拟机迁移前处理' },
  { pattern: /PostHook|post-migration hook/i, label: '执行虚拟机迁移后处理' },
  { pattern: /Initialize|Initialize migration|准备迁移/i, label: '初始化虚拟机迁移环境' },
];

/** Converts controller step names/descriptions into stable, business-facing Chinese labels. */
export function getMigrationStepLabel(step: Pick<MigrationTask, 'name' | 'description'> | string): string {
  const name = typeof step === 'string' ? step : step.name;
  const description = typeof step === 'string' ? '' : step.description || '';
  const source = `${name} ${description}`.trim();
  const matched = migrationStepLabels.find(({ pattern }) => pattern.test(source));
  if (matched) return matched.label;
  if (description && containsChinese(description)) return description;
  if (containsChinese(name)) return name;
  return '处理虚拟机迁移资源';
}

export function getMigrationTaskLabel(task: MigrationTask): string {
  const value = task.description || task.name;
  if (containsChinese(value)) return value;
  if (/^disk[-_\s]?\d+$/i.test(task.name)) return `复制磁盘 ${task.name}`;
  return getMigrationStepLabel(task);
}

export function getMigrationPhaseLabel(value?: string): string {
  if (!value) return '等待执行';
  if (containsChinese(value)) return value;
  if (/Completed|Succeeded/i.test(value)) return '已完成';
  if (/Failed|Error/i.test(value)) return '失败';
  if (/Canceled|Cancelled/i.test(value)) return '已取消';
  if (/Skipped/i.test(value)) return '已跳过';
  if (/Running|Progress|Copying|Executing|Import|Started/i.test(value)) return '执行中';
  if (/Ready/i.test(value)) return '已就绪';
  if (/Pending|Unknown/i.test(value)) return '等待执行';
  return '状态更新中';
}

export function getStepFailure(step: MigrationStep): string[] {
  const reasons = [
    ...(step.error?.reasons || []),
    ...(step.tasks || []).flatMap((task) => task.error?.reasons || []),
  ];
  if (reasons.length === 0 && step.reason && /fail|error/i.test(step.phase || '')) reasons.push(step.reason);
  return Array.from(new Set(reasons));
}

export function isDiskTransferStep(step: MigrationStep): boolean {
  return /DiskTransfer|CopyDisks|Cutover/i.test(step.name)
    || /copy disks|transfer disks|finalize disk transfer|复制磁盘|完成磁盘传输/i.test(step.description || '');
}

function isFinalDiskTransferStep(step: MigrationStep): boolean {
  return /Cutover/i.test(step.name) || /finalize disk transfer/i.test(step.description || '');
}

function stepHasStarted(step: MigrationStep): boolean {
  return Boolean(
    step.started
    || step.completed
    || /Running|Progress|Copying|Import|Completed|Succeeded/i.test(step.phase || '')
    || (step.progress?.completed || 0) > 0,
  );
}

export function getCurrentDiskTransferStep(vm: VMStatus): MigrationStep | undefined {
  const steps = (vm.pipeline || []).filter(isDiskTransferStep);
  const finalTransfers = steps.filter(isFinalDiskTransferStep);
  const completedFinalTransfer = finalTransfers.filter(isStepComplete).at(-1);
  // A completed final transfer is authoritative. Controllers can append a fresh,
  // pending Cutover record while reconciling; that zero-value record must not
  // make an already completed transfer appear to restart from 0%.
  if (completedFinalTransfer) return completedFinalTransfer;
  const activeFinalTransfer = finalTransfers.filter(stepHasStarted).reduce<MigrationStep | undefined>((selected, step) => {
    if (!selected) return step;
    return progressPercent(step.progress) >= progressPercent(selected.progress) ? step : selected;
  }, undefined);
  if (activeFinalTransfer) return activeFinalTransfer;
  const regularTransfers = steps.filter((step) => !isFinalDiskTransferStep(step));
  return regularTransfers.find((step) => !step.completed && !/Completed|Succeeded/i.test(step.phase || ''))
    || regularTransfers.at(-1)
    || finalTransfers.at(-1);
}

export function getBaseDiskTransferStep(vm: VMStatus): MigrationStep | undefined {
  const steps = (vm.pipeline || []).filter((step) => isDiskTransferStep(step) && !isFinalDiskTransferStep(step));
  return steps.find((step) => !isStepComplete(step)) || steps.at(-1);
}

export function isDiskTransferComplete(vm: VMStatus, step = getCurrentDiskTransferStep(vm)): boolean {
  if (!step || getStepFailure(step).length > 0) return false;
  if (isStepComplete(step)) return true;
  if (vm.completed && !getVmFailure(vm)) return true;

  const pipeline = vm.pipeline || [];
  const stepIndex = pipeline.indexOf(step);
  return stepIndex >= 0 && pipeline.slice(stepIndex + 1).some((laterStep) =>
    !isDiskTransferStep(laterStep)
    && Boolean(
      laterStep.started
      || laterStep.completed
      || /Running|Progress|Copying|Import|Completed|Succeeded|Failed|Error/i.test(laterStep.phase || ''),
    ),
  );
}

export function diskTransferProgressPercent(vm: VMStatus, step = getCurrentDiskTransferStep(vm)): number {
  return stepProgressPercent(step, isDiskTransferComplete(vm, step));
}

export function getLatestMigration(plan: Plan, migrations: Migration[]): Migration | undefined {
  const migrationRef = plan.status?.migration?.history?.at(-1)?.migration;
  const fromHistory = migrationRef && migrations.find((migration) =>
    (migrationRef.uid && migration.metadata.uid === migrationRef.uid)
    || (migrationRef.name && migration.metadata.name === migrationRef.name),
  );
  if (fromHistory) return fromHistory;

  return migrations
    .filter((migration) => migration.spec.plan.name === plan.metadata.name)
    .sort((left, right) => Date.parse(right.metadata.creationTimestamp || '') - Date.parse(left.metadata.creationTimestamp || ''))[0];
}

export function getVmFailure(vm: VMStatus): { stage: string; reasons: string[] } | null {
  const failedStep = vm.pipeline?.find((step) => getStepFailure(step).length > 0);
  const failedCondition = vm.conditions?.find((condition) =>
    condition.status === 'True' && (
      ['Critical', 'Error'].includes(condition.category || '') ||
      /Failed|Error/i.test(condition.type)
    ),
  );
  const reasons = [
    ...(vm.error?.reasons || []),
    ...(failedStep ? getStepFailure(failedStep) : []),
    ...(failedCondition?.message || failedCondition?.reason
      ? [failedCondition.message || failedCondition.reason || '']
      : []),
  ];
  if (reasons.length === 0) return null;
  return {
    stage: failedStep?.description || failedStep?.name || vm.error?.phase || failedCondition?.reason || failedCondition?.type || vm.phase || '未知阶段',
    reasons: Array.from(new Set(reasons)),
  };
}
