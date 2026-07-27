import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvFile } from './preflight.mjs';

function normalizeHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${label} must be an HTTPS origin without a path`);
  }
  return url.origin;
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyRedirect(fetchImpl, httpsOrigin, label) {
  const https = new URL(httpsOrigin);
  const source = `http://${https.host}/healthz`;
  const expected = `${httpsOrigin}/healthz`;
  const response = await fetchWithTimeout(fetchImpl, source, {
    redirect: 'manual',
  });
  if (
    ![301, 302, 307, 308].includes(response.status) ||
    response.headers.get('location') !== expected
  ) {
    throw new Error(`${label} HTTP redirect did not point to HTTPS`);
  }
}

export async function smokeProduction({
  apiBaseUrl,
  adminBaseUrl,
  fetchImpl = fetch,
  log = () => {},
}) {
  const apiOrigin = normalizeHttpsOrigin(apiBaseUrl, 'API base URL');
  const adminOrigin = normalizeHttpsOrigin(adminBaseUrl, 'Admin base URL');

  const health = await fetchWithTimeout(
    fetchImpl,
    `${apiOrigin}/api/health`,
  );
  if (!health.ok) {
    throw new Error(`API health returned HTTP ${health.status}`);
  }
  let healthBody;
  try {
    healthBody = await health.json();
  } catch {
    throw new Error('API health envelope is not JSON');
  }
  if (
    healthBody?.success !== true ||
    healthBody?.data?.status !== 'ok'
  ) {
    throw new Error('API health envelope is invalid');
  }
  log('API HTTPS health passed.');

  const admin = await fetchWithTimeout(fetchImpl, `${adminOrigin}/`);
  const contentType = admin.headers.get('content-type') ?? '';
  const adminBody = await admin.text();
  if (
    !admin.ok ||
    !contentType.toLowerCase().includes('text/html') ||
    !/<html[\s>]/i.test(adminBody)
  ) {
    throw new Error('Admin HTML check failed');
  }
  log('Admin HTTPS HTML passed.');

  await verifyRedirect(fetchImpl, apiOrigin, 'API');
  await verifyRedirect(fetchImpl, adminOrigin, 'Admin');
  log('HTTP to HTTPS redirects passed.');

  return {
    apiHealth: 'ok',
    adminHtml: 'ok',
    apiRedirect: 'ok',
    adminRedirect: 'ok',
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const envFile = optionValue('--env-file');
  const fileEnv = envFile
    ? readEnvFile(path.resolve(process.cwd(), envFile))
    : {};
  const env = { ...fileEnv, ...process.env };
  await smokeProduction({
    apiBaseUrl:
      optionValue('--api') ??
      env.SMOKE_API_BASE_URL ??
      `https://${env.API_DOMAIN}`,
    adminBaseUrl:
      optionValue('--admin') ??
      env.SMOKE_ADMIN_BASE_URL ??
      `https://${env.ADMIN_DOMAIN}`,
    log: console.log,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
