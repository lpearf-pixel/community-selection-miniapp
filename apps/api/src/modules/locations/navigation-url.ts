export function buildAmapSearchUrl(input: { address: string; name?: string | null }): string {
  const parts = [input.address.trim(), input.name?.trim()].filter(Boolean);
  const keyword = encodeURIComponent(parts.join(' '));
  return `https://uri.amap.com/search?keyword=${keyword}&src=community-selection&callnative=1`;
}
