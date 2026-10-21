import { describe, expect, it } from 'vitest';
import type { Provider } from './types';
import { isEISTargetProvider, isSourceProvider, providerRoleLabel } from './providers';

function provider(name: string, url: string, labels?: Record<string, string>): Provider {
  return {
    apiVersion: 'forklift.konveyor.io/v1beta1',
    kind: 'Provider',
    metadata: { name, labels },
    spec: { type: 'openshift', url },
  };
}

describe('provider roles', () => {
  it('keeps the built-in local provider as a target', () => {
    expect(isEISTargetProvider(provider('host', ''))).toBe(true);
  });

  it('uses the explicit role for remote EIS targets', () => {
    const target = provider('remote-target', 'https://api.example:6443', { [providerRoleLabel]: 'target' });
    expect(isEISTargetProvider(target)).toBe(true);
    expect(isSourceProvider(target)).toBe(false);
  });

  it('continues to treat an unlabelled remote KubeVirt provider as a source', () => {
    const source = provider('remote-source', 'https://api.source.example:6443');
    expect(isEISTargetProvider(source)).toBe(false);
    expect(isSourceProvider(source)).toBe(true);
  });
});
