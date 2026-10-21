import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('resource formatting', () => {
  it('formats inventory storage values as bytes', () => {
    expect(formatBytes(120 * 1024 ** 3)).toBe('120 GiB');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8 GiB');
    expect(formatBytes(1.25 * 1024 ** 4)).toBe('1.3 TiB');
  });
});
