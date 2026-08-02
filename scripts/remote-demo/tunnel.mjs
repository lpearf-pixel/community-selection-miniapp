const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const QUICK_TUNNEL_HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;

export function normalizeQuickTunnelUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid Cloudflare Quick Tunnel URL');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !QUICK_TUNNEL_HOST_PATTERN.test(hostname)
  ) {
    throw new Error('Invalid Cloudflare Quick Tunnel HTTPS origin');
  }
  return `https://${hostname}`;
}

export function extractQuickTunnelUrls(text) {
  const matches = String(text ?? '').match(URL_PATTERN) ?? [];
  const quickTunnelUrls = new Set();
  for (const candidate of matches) {
    if (!candidate.toLowerCase().includes('trycloudflare.com')) continue;
    quickTunnelUrls.add(normalizeQuickTunnelUrl(candidate));
  }
  return [...quickTunnelUrls];
}

export function resolveUniqueQuickTunnelUrl(chunks) {
  if (!Array.isArray(chunks)) {
    throw new Error('Quick Tunnel output chunks are required');
  }
  const urls = new Set();
  for (const chunk of chunks) {
    for (const url of extractQuickTunnelUrls(chunk)) urls.add(url);
  }
  if (urls.size !== 1) {
    throw new Error('Cloudflare output must contain exactly one Quick Tunnel URL');
  }
  return [...urls][0];
}
