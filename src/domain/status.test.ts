import { describe, expect, it } from 'vitest';
import {
  getCurrentDiskTransferStep,
  diskTransferProgressPercent,
  getLatestMigration,
  getPlanMigrationType,
  getStepFailure,
  getVmFailure,
  isDiskTransferStep,
  isDiskTransferComplete,
  isPlanEditable,
  isPlanReady,
  progressPercent,
  stepProgressPercent,
} from './status';
import type { Migration, Plan, VMStatus } from './types';

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  apiVersion: 'forklift.konveyor.io/v1beta1',
  kind: 'Plan',
  metadata: { name: 'plan-a', namespace: 'konveyor-forklift', generation: 2 },
  spec: {
    targetNamespace: 'workloads',
    provider: { source: { name: 'source' }, destination: { name: 'host' } },
    map: { network: { name: 'network-map' }, storage: { name: 'storage-map' } },
    vms: [{ id: 'vm-1' }],
    skipGuestConversion: false,
    runPreflightInspection: true,
  },
  status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True' }] },
  ...overrides,
});

describe('migration status helpers', () => {
  it('converts CDI byte progress into a bounded percentage', () => {
    expect(progressPercent({ total: 1024, completed: 768 })).toBe(75);
    expect(progressPercent({ total: 100, completed: 120 })).toBe(100);
  });

  it('normalizes completed stages and stale importer counters to 100 percent', () => {
    expect(stepProgressPercent({ name: 'disk-0', phase: 'Completed', progress: { total: 100, completed: 98 } })).toBe(100);
    const vm: VMStatus = {
      id: 'vm-1',
      pipeline: [
        { name: 'DiskTransfer', phase: 'Running', progress: { total: 100, completed: 98 }, tasks: [{ name: 'disk-0', phase: 'ImportInProgress', progress: { total: 100, completed: 98 } }] },
        { name: 'CreateVM', phase: 'Completed', completed: '2026-10-19T00:00:00Z' },
      ],
    };

    expect(isDiskTransferComplete(vm)).toBe(true);
    expect(diskTransferProgressPercent(vm)).toBe(100);
  });

  it('does not mark a completed disk copy as failed when conversion fails later', () => {
    const vm: VMStatus = {
      id: 'vm-1',
      pipeline: [
        { name: 'DiskTransfer', phase: 'Completed', progress: { total: 100, completed: 100 } },
        { name: 'ImageConversion', phase: 'Failed', error: { reasons: ['no space left on device'] } },
      ],
    };

    expect(getStepFailure(vm.pipeline![0])).toEqual([]);
    expect(getVmFailure(vm)).toEqual({ stage: 'ImageConversion', reasons: ['no space left on device'] });
  });

  it('uses critical VM conditions when the pipeline has no structured error', () => {
    const vm: VMStatus = {
      id: 'vm-2',
      phase: 'Failed',
      conditions: [{
        type: 'DiskTransferFailed',
        status: 'True',
        category: 'Critical',
        reason: 'ImporterFailed',
        message: 'DataVolume importer pod exited with status 1',
      }],
    };

    expect(getVmFailure(vm)).toEqual({
      stage: 'ImporterFailed',
      reasons: ['DataVolume importer pod exited with status 1'],
    });
  });

  it('recognizes migration type when the current type field is absent', () => {
    expect(getPlanMigrationType(plan({ spec: { ...plan().spec, warm: true } }))).toBe('warm');
    expect(getPlanMigrationType(plan({ spec: { ...plan().spec, vms: [{ id: 'vm-22', warm: false }] } }))).toBe('cold');
    expect(getPlanMigrationType(plan({ spec: { ...plan().spec, vms: [{ id: 'vm-22', warm: true }] } }))).toBe('warm');
  });

  it('only allows execution after the current generation is ready and unblocked', () => {
    expect(isPlanReady(plan())).toBe(true);
    expect(isPlanReady(plan({ status: { observedGeneration: 1, conditions: [{ type: 'Ready', status: 'True' }] } }))).toBe(false);
    expect(isPlanReady(plan({ status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'False' }] } }))).toBe(false);
    expect(isPlanReady(plan({ status: { observedGeneration: 2, conditions: [
      { type: 'Ready', status: 'True' },
      { type: 'PlanInvalid', status: 'True', category: 'Critical', message: 'Storage map is not ready' },
    ] } }))).toBe(false);
  });

  it('only allows editing before a plan has started', () => {
    expect(isPlanEditable(plan())).toBe(true);
    expect(isPlanEditable(plan({ status: { migration: { started: '2026-10-19T00:00:00Z' } } }))).toBe(false);
    expect(isPlanEditable(plan({ spec: { ...plan().spec, archived: true } }))).toBe(false);
    expect(isPlanEditable(plan({ status: { conditions: [{ type: 'Executing', status: 'True' }] } }))).toBe(false);
  });

  it('uses the final warm transfer progress after Cutover starts', () => {
    const initial = { name: 'DiskTransfer', phase: 'Completed', progress: { total: 100, completed: 100 } };
    const finalize = { name: 'Cutover', description: 'Finalize disk transfer.', phase: 'Running', progress: { total: 100, completed: 35 } };
    const vm: VMStatus = { id: 'vm-1', pipeline: [initial, finalize] };

    expect(isDiskTransferStep(finalize)).toBe(true);
    expect(getCurrentDiskTransferStep(vm)).toBe(finalize);
    expect(getCurrentDiskTransferStep({ ...vm, pipeline: [initial, { ...finalize, phase: 'Pending', progress: { total: 100, completed: 0 } }] })).toBe(initial);
  });

  it('selects the migration referenced by the latest plan history item', () => {
    const oldMigration: Migration = {
      apiVersion: 'forklift.konveyor.io/v1beta1', kind: 'Migration',
      metadata: { name: 'migration-1', uid: 'migration-1', creationTimestamp: '2026-01-01T00:00:00Z' },
      spec: { plan: { name: 'plan-a' } },
    };
    const latestMigration: Migration = {
      ...oldMigration,
      metadata: { name: 'migration-2', uid: 'migration-2', creationTimestamp: '2026-01-02T00:00:00Z' },
    };
    const value = plan({ status: {
      observedGeneration: 2,
      conditions: [{ type: 'Executing', status: 'True' }],
      migration: { history: [{ migration: { name: 'migration-2', uid: 'migration-2' } }] },
    } });

    expect(getLatestMigration(value, [oldMigration, latestMigration])).toBe(latestMigration);
  });
});
