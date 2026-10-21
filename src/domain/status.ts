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

export function getCurrentDiskTransferStep(vm: VMStatus): MigrationStep | undefined {
  const steps = (vm.pipeline || []).filter(isDiskTransferStep);
  const finalTransfer = steps.find((step) => /Cutover/i.test(step.name) || /finalize disk transfer/i.test(step.description || ''));
  const finalTransferStarted = finalTransfer && (
    Boolean(finalTransfer.started)
    || /Running|Progress|Copying/i.test(finalTransfer.phase || '')
    || (finalTransfer.progress?.completed || 0) > 0
  );
  if (finalTransferStarted) return finalTransfer;
  const regularTransfers = steps.filter((step) => step !== finalTransfer);
  return regularTransfers.find((step) => !step.completed && !/Completed|Succeeded/i.test(step.phase || ''))
    || regularTransfers.at(-1)
    || finalTransfer;
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
