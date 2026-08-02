const assert = require('node:assert/strict');
const test = require('node:test');

test('extracts one normalized Quick Tunnel HTTPS origin from log chunks', async () => {
  const { extractQuickTunnelUrls, resolveUniqueQuickTunnelUrl } = await import(
    './tunnel.mjs'
  );
  assert.deepEqual(
    extractQuickTunnelUrls(
      'INF Requesting new quick Tunnel\nINF https://Demo-One.trycloudflare.com\n',
    ),
    ['https://demo-one.trycloudflare.com'],
  );
  assert.equal(
    resolveUniqueQuickTunnelUrl([
      'unrelated https://developers.cloudflare.com/page',
      'INF https://demo-one.trycloudflare.com',
      'INF https://demo-one.trycloudflare.com',
    ]),
    'https://demo-one.trycloudflare.com',
  );
});

test('rejects missing or multiple Quick Tunnel origins', async () => {
  const { resolveUniqueQuickTunnelUrl } = await import('./tunnel.mjs');
  assert.throws(() => resolveUniqueQuickTunnelUrl(['no tunnel here']), /exactly one/i);
  assert.throws(
    () =>
      resolveUniqueQuickTunnelUrl([
        'https://one.trycloudflare.com',
        'https://two.trycloudflare.com',
      ]),
    /exactly one/i,
  );
});

test('rejects insecure, lookalike, credentialed, and non-origin URLs', async () => {
  const { resolveUniqueQuickTunnelUrl } = await import('./tunnel.mjs');
  for (const candidate of [
    'http://demo.trycloudflare.com',
    'https://demo.trycloudflare.com.evil.example',
    'https://user:pass@demo.trycloudflare.com',
    'https://demo.trycloudflare.com/path',
    'https://demo.trycloudflare.com?token=private',
    'https://demo.trycloudflare.com#fragment',
    'https://trycloudflare.com',
  ]) {
    assert.throws(
      () => resolveUniqueQuickTunnelUrl([candidate]),
      /Quick Tunnel|exactly one/i,
    );
  }
});
