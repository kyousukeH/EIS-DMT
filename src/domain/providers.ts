import type { Provider, ProviderType } from './types';

export const providerRoleLabel = 'eis-dmt.io/role';

export const providerTypeLabels: Record<ProviderType, string> = {
  vsphere: 'VMware vSphere',
  ovirt: 'oVirt / RHV',
  openstack: 'OpenStack',
  openshift: 'KubeVirt 集群',
  ova: 'OVA / NFS',
  ec2: 'Amazon EC2',
  hyperv: 'Microsoft Hyper-V',
  nutanix: 'Nutanix',
  azure: 'Microsoft Azure (Preview)',
};

export const isEISTargetProvider = (provider: Provider) =>
  provider.metadata.labels?.[providerRoleLabel] === 'target'
  || (provider.spec.type === 'openshift' && !provider.spec.url);

export const isSourceProvider = (provider: Provider) => !isEISTargetProvider(provider);

export const providerDisplayType = (provider: Provider) =>
  isEISTargetProvider(provider) ? 'EIS 目标集群' : providerTypeLabels[provider.spec.type];
