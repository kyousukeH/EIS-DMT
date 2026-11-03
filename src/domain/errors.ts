export interface FriendlyMigrationError {
  title: string;
  guidance: string;
  original: string;
}

export interface FriendlyMigrationErrorGroup extends Omit<FriendlyMigrationError, 'original'> {
  originals: string[];
}

const errorRules: Array<{ pattern: RegExp; title: string; guidance: string }> = [
  {
    pattern: /VDDK library.*failed|VDDK.*(?:connect|connection|load).*fail/i,
    title: '高级磁盘读取组件连接异常',
    guidance: '请检查源端平台设置中的磁盘读取组件镜像地址，并确认到 vCenter 的 443 和 902 端口连通。',
  },
  {
    pattern: /no operating system found/i,
    title: '操作系统识别失败',
    guidance: '磁盘引导分区可能缺失或文件系统已损坏，驱动适配程序无法识别并注入驱动。',
  },
  {
    pattern: /Keystone authentication failed/i,
    title: 'OpenStack 鉴权失败',
    guidance: '请检查源端平台中的 Keystone 地址、认证凭据和令牌是否有效。',
  },
  {
    pattern: /no space left on device|insufficient.*space|disk.*full|磁盘空间不足/i,
    title: '可用磁盘空间不足',
    guidance: '请清理源虚拟机文件系统或扩容目标临时存储，然后从失败阶段重试。',
  },
  {
    pattern: /DataVolume.*(?:fail|error)|importer pod.*(?:fail|exited)/i,
    title: '目标磁盘导入失败',
    guidance: '请检查目标存储容量、目标存储状态以及数据导入任务的事件和网络连通性。',
  },
];

export function translateMigrationError(original: string): FriendlyMigrationError {
  const matched = errorRules.find((rule) => rule.pattern.test(original));
  return matched
    ? { title: matched.title, guidance: matched.guidance, original }
    : {
        title: '迁移阶段执行失败',
        guidance: '请根据失败阶段检查源端连接、目标资源容量和相关工作负载事件。',
        original,
      };
}

export function translateMigrationErrors(originals: string[]): FriendlyMigrationErrorGroup[] {
  const groups = new Map<string, FriendlyMigrationErrorGroup>();
  for (const original of Array.from(new Set(originals))) {
    const translated = translateMigrationError(original);
    const key = `${translated.title}\n${translated.guidance}`;
    const group = groups.get(key);
    if (group) group.originals.push(original);
    else groups.set(key, { title: translated.title, guidance: translated.guidance, originals: [original] });
  }
  return Array.from(groups.values());
}
