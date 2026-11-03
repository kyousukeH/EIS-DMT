import type { Provider, ProviderType } from './types';

export const providerRoleLabel = 'eis-dmt.io/role';

export const providerTypeLabels: Record<ProviderType, string> = {
  vsphere: 'VMware vSphere',
  ovirt: 'oVirt / RHV',
  openstack: 'OpenStack',
  openshift: 'EIS 兼容虚拟化平台',
  ova: 'OVA / NFS',
  ec2: 'Amazon EC2',
  hyperv: 'Microsoft Hyper-V',
  nutanix: 'Nutanix',
  azure: 'Microsoft Azure (Preview)',
};

export const isEISTargetProvider = (provider: Provider) =>
  provider.metadata.labels?.[providerRoleLabel] === 'target'
  || (provider.spec.type === 'openshift' && !provider.spec.url);

export const isLocalEISTargetProvider = (provider: Provider) =>
  isEISTargetProvider(provider) && provider.spec.type === 'openshift' && !provider.spec.url;

export const isSourceProvider = (provider: Provider) => !isEISTargetProvider(provider);

export const providerDisplayType = (provider: Provider) =>
  isLocalEISTargetProvider(provider)
    ? '本机 EIS 目标集群'
    : isEISTargetProvider(provider)
      ? '远程 EIS 目标集群'
      : providerTypeLabels[provider.spec.type];
