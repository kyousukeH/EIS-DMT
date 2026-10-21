import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createResource, deleteResource, listInventoryNamespaces, listInventoryNetworks, listInventoryStorages, listInventoryVMs, patchResource, resources, type ForkliftResource } from './client';
import type { ForkliftController, Migration, NetworkMap, Plan, Provider, StorageMap } from '../domain/types';

const polling = 5_000;

export const useProviders = () => useQuery({ queryKey: ['providers'], queryFn: resources.providers, refetchInterval: polling });
export const useNetworkMaps = () => useQuery({ queryKey: ['networkmaps'], queryFn: resources.networkMaps, refetchInterval: polling });
export const useStorageMaps = () => useQuery({ queryKey: ['storagemaps'], queryFn: resources.storageMaps, refetchInterval: polling });
export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: resources.plans, refetchInterval: polling });
export const useMigrations = () => useQuery({ queryKey: ['migrations'], queryFn: resources.migrations, refetchInterval: polling });
export const useControllers = () => useQuery({ queryKey: ['forkliftcontrollers'], queryFn: resources.controllers, refetchInterval: polling });
export const useInventoryVMs = (provider?: Provider) => useQuery({
  queryKey: ['inventory-vms', provider?.metadata.uid],
  queryFn: () => listInventoryVMs(provider as Provider),
  enabled: Boolean(provider),
});
export const useInventoryNamespaces = (provider?: Provider) => useQuery({
  queryKey: ['inventory-namespaces', provider?.metadata.uid],
  queryFn: () => listInventoryNamespaces(provider as Provider),
  enabled: Boolean(provider),
});
export const useInventoryNetworks = (provider: Provider | undefined, role: 'source' | 'target') => useQuery({
  queryKey: ['inventory-networks', role, provider?.metadata.uid],
  queryFn: () => listInventoryNetworks(provider as Provider, role),
  enabled: Boolean(provider),
});
export const useInventoryStorages = (provider: Provider | undefined, role: 'source' | 'target') => useQuery({
  queryKey: ['inventory-storages', role, provider?.metadata.uid],
  queryFn: () => listInventoryStorages(provider as Provider, role),
  enabled: Boolean(provider),
});

type Creatable = Provider | NetworkMap | StorageMap | Plan | Migration;

export function useCreateResource<T extends Creatable>(resource: ForkliftResource) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => createResource(resource, body),
    onSuccess: () => client.invalidateQueries({ queryKey: [resource] }),
  });
}

export function usePatchResource<T = unknown>(resource: ForkliftResource) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: object }) => patchResource<T>(resource, name, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: [resource] }),
  });
}

export function useDeleteResource(resource: ForkliftResource) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteResource(resource, name),
    onSuccess: () => client.invalidateQueries({ queryKey: [resource] }),
  });
}

export type ControllerMutation = ReturnType<typeof usePatchResource<ForkliftController>>;
