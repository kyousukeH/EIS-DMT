import { describe, expect, it } from 'vitest';
import { translateMigrationError, translateMigrationErrors } from './errors';

describe('migration error dictionary', () => {
  it.each([
    ['VDDK library load failed', '高级磁盘读取组件连接异常'],
    ['no operating system found', '操作系统识别失败'],
    ['Keystone authentication failed: token expired', 'OpenStack 鉴权失败'],
    ['no space left on device', '可用磁盘空间不足'],
    ['目标磁盘空间不足，无法写入临时文件。', '可用磁盘空间不足'],
  ])('translates %s', (message, title) => {
    expect(translateMigrationError(message)).toMatchObject({ title, original: message });
  });

  it('groups different technical errors with the same user guidance', () => {
    const translated = translateMigrationErrors([
      'virt-v2v inspection failed: no space left on device',
      '目标磁盘空间不足，无法写入临时文件。',
    ]);
    expect(translated).toHaveLength(1);
    expect(translated[0]).toMatchObject({ title: '可用磁盘空间不足' });
    expect(translated[0].originals).toHaveLength(2);
  });
});
