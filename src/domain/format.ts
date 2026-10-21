export function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '-';
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const normalized = value / 1024 ** unitIndex;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: normalized >= 100 ? 0 : 1 }).format(normalized)} ${units[unitIndex]}`;
}
