import type {
  Migration,
  MigrationType,
  NetworkMap,
  ObjectReference,
  Plan,
  Provider,
  StorageMap,
} from './types';

const apiVersion = 'forklift.konveyor.io/v1beta1' as const;

export interface PlanInput {
  name: string;
  namespace: string;
  description?: string;
  targetNamespace: string;
  type: MigrationType;
  source: Provider;
  destination: Provider;
  networkMap: NetworkMap;
  storageMap: StorageMap;
  vmIds: string[];
  skipGuestConversion: boolean;
  runPreflightInspection: boolean;
  targetPowerState: 'on' | 'off' | 'auto';
  preserveStaticIPs: boolean;
}

export function ref(resource: { metadata: { name: string; namespace?: string; uid?: string } }): ObjectReference {
  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace,
    ...(resource.metadata.uid ? { uid: resource.metadata.uid } : {}),
  };
}

export function buildPlan(input: PlanInput): Plan {
  return {
    apiVersion,
    kind: 'Plan',
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      description: input.description,
      targetNamespace: input.targetNamespace,
      type: input.type,
      warm: input.type === 'warm',
      provider: { source: ref(input.source), destination: ref(input.destination) },
      map: { network: ref(input.networkMap), storage: ref(input.storageMap) },
      vms: input.vmIds.map((id) => ({ id })),
      skipGuestConversion: input.skipGuestConversion,
      runPreflightInspection: input.runPreflightInspection,
      targetPowerState: input.targetPowerState,
      preserveStaticIPs: input.preserveStaticIPs,
    },
  };
}

export interface StorageMapInput {
  name: string;
  namespace: string;
  source: Provider;
  destination: Provider;
  pairs: Array<{
    sourceId: string;
    sourceName?: string;
    sourceNamespace?: string;
    sourceType?: string;
    storageClass: string;
    volumeMode?: 'Block' | 'Filesystem';
    accessMode?: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany';
  }>;
  volumeMode?: 'Block' | 'Filesystem';
  accessMode?: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany';
}

export function buildStorageMap(input: StorageMapInput): StorageMap {
  const volumeMode = input.volumeMode ?? 'Block';
  const accessMode = input.accessMode ?? 'ReadWriteMany';
  return {
    apiVersion,
    kind: 'StorageMap',
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      provider: { source: ref(input.source), destination: ref(input.destination) },
      map: input.pairs.map((pair) => ({
        source: {
          ...(pair.sourceId ? { id: pair.sourceId } : {}),
          ...(pair.sourceName ? { name: pair.sourceName } : {}),
          ...(pair.sourceNamespace ? { namespace: pair.sourceNamespace } : {}),
          ...(pair.sourceType ? { type: pair.sourceType } : {}),
        },
        destination: {
          storageClass: pair.storageClass,
          volumeMode: pair.volumeMode ?? volumeMode,
          accessMode: pair.accessMode ?? accessMode,
        },
      })),
    },
  };
}

export function buildMigration(plan: Plan, options?: { resumeConversion?: boolean }): Migration {
  return {
    apiVersion,
    kind: 'Migration',
    metadata: {
      name: `${plan.metadata.name}-${Date.now().toString(36)}`,
      namespace: plan.metadata.namespace,
    },
    spec: {
      plan: ref(plan),
      ...(options?.resumeConversion ? { resumeConversion: true } : {}),
    },
  };
}

export function buildValidationPatch(enabled: boolean): { spec: { feature_validation: string } } {
  return { spec: { feature_validation: String(enabled) } };
}
