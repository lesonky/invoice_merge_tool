export function formatBytes(size: number): string {
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / 1024 ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDate(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleString();
}
