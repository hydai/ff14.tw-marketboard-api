export function buildIconUrl(iconPath: string): string | null {
  if (!iconPath) return null;
  return `https://v2.xivapi.com/api/asset?path=${encodeURIComponent(iconPath)}&format=png`;
}
