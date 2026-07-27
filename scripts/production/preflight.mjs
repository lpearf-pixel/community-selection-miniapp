import { execFileSync } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRuntimeConfig } from '../../packages/config/dist/index.js';

export function parseEnvText(text) {
  const values = {};
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator < 1) {
      throw new Error(`Invalid environment line ${index + 1}`);
    }
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment key on line ${index + 1}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`Duplicate environment key: ${key}`);
    }
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function readEnvFile(file) {
  return parseEnvText(fs.readFileSync(file, 'utf8'));
}

function requireSecret(root, relativePath, marker, minimumLength = 1) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Required secret file is missing: ${relativePath}`);
  }
  const mode = fs.statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Secret file must not be group/world accessible: ${relativePath}`,
    );
  }
  const content = fs.readFileSync(file, 'utf8').trim();
  if (content.length < minimumLength || (marker && !content.includes(marker))) {
    throw new Error(`Secret file is invalid: ${relativePath}`);
  }
}

function requirePrivateKey(root, relativePath, apiRuntimeUid) {
  const file = path.join(root, relativePath);
  requireSecret(root, relativePath, 'BEGIN PRIVATE KEY');
  const stat = fs.statSync(file);
  if (stat.uid !== apiRuntimeUid) {
    throw new Error(
      `Payment secret must be owned by API runtime uid ${apiRuntimeUid}: ${relativePath}`,
    );
  }
  try {
    createPrivateKey(fs.readFileSync(file));
  } catch {
    throw new Error(`Payment private key is invalid: ${relativePath}`);
  }
}

function normalizeCertificateSerial(value) {
  return String(value ?? '')
    .replace(/[^a-f0-9]/gi, '')
    .replace(/^0+/, '')
    .toUpperCase();
}

export function validateCertificateMetadata(
  certificate,
  expectedSerial,
  now = new Date(),
) {
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (
    !Number.isFinite(validFrom.getTime()) ||
    !Number.isFinite(validTo.getTime()) ||
    now < validFrom
  ) {
    throw new Error('Payment platform certificate is not yet valid');
  }
  if (now > validTo) {
    throw new Error('Payment platform certificate is expired');
  }
  if (
    normalizeCertificateSerial(certificate.serialNumber) !==
    normalizeCertificateSerial(expectedSerial)
  ) {
    throw new Error(
      'Payment platform certificate serial does not match WECHAT_PAY_PLATFORM_SERIAL_NO',
    );
  }
}

function requireCertificate(
  root,
  relativePath,
  apiRuntimeUid,
  expectedSerial,
) {
  const file = path.join(root, relativePath);
  requireSecret(root, relativePath, 'BEGIN CERTIFICATE');
  const stat = fs.statSync(file);
  if (stat.uid !== apiRuntimeUid) {
    throw new Error(
      `Payment secret must be owned by API runtime uid ${apiRuntimeUid}: ${relativePath}`,
    );
  }
  try {
    const certificate = new X509Certificate(fs.readFileSync(file));
    validateCertificateMetadata(certificate, expectedSerial);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Payment platform certificate')
    ) {
      throw error;
    }
    throw new Error(`Payment certificate is invalid: ${relativePath}`);
  }
}

function requirePrivateEnvFile(root, envFile) {
  const file = path.resolve(root, envFile);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Production environment file is missing: ${envFile}`);
  }
  if ((fs.statSync(file).mode & 0o077) !== 0) {
    throw new Error(
      `Production environment file must not be group/world accessible: ${envFile}`,
    );
  }
}

function validateDeploymentValues(env) {
  const problems = [];
  for (const [key, value] of Object.entries(env)) {
    if (/replace-with|changeme|example-secret/i.test(value)) {
      problems.push(`placeholder value remains in ${key}`);
    }
  }
  if (!/^[a-f0-9]{7,40}$/i.test(env.IMAGE_TAG ?? '')) {
    problems.push('IMAGE_TAG must be a 7-40 character Git commit SHA');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.ACME_EMAIL ?? '')) {
    problems.push('ACME_EMAIL must be a valid operations email');
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(env.POSTGRES_PASSWORD ?? '')) {
    problems.push(
      'POSTGRES_PASSWORD must be at least 32 URL-safe characters',
    );
  }
  if (!env.POSTGRES_DB) problems.push('POSTGRES_DB is required');
  if (!env.POSTGRES_USER) problems.push('POSTGRES_USER is required');
  try {
    const database = new URL(env.DATABASE_URL ?? '');
    if (
      database.protocol !== 'postgresql:' ||
      decodeURIComponent(database.username) !== env.POSTGRES_USER ||
      decodeURIComponent(database.password) !== env.POSTGRES_PASSWORD ||
      database.hostname !== 'postgres' ||
      database.pathname !== `/${env.POSTGRES_DB}`
    ) {
      problems.push(
        'DATABASE_URL must match the production PostgreSQL service credentials',
      );
    }
  } catch {
    problems.push('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    !/^[1-9][0-9]*$/.test(env.BACKUP_RETENTION_DAYS ?? '') ||
    Number(env.BACKUP_RETENTION_DAYS) < 7
  ) {
    problems.push('BACKUP_RETENTION_DAYS must be an integer of at least 7');
  }
  if (problems.length > 0) {
    throw new Error(`Production preflight failed: ${problems.join('; ')}`);
  }
}

export async function preflightProduction({
  env,
  root = process.cwd(),
  envFile = '.env.production',
  apiRuntimeUid,
  run = (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }),
  log = console.log,
}) {
  validateRuntimeConfig(env);
  validateDeploymentValues(env);
  requirePrivateEnvFile(root, envFile);
  const expectedApiUid =
    apiRuntimeUid ??
    fs.statSync(path.join(root, 'secrets/wechat_private_key.pem')).uid;
  requirePrivateKey(
    root,
    'secrets/wechat_private_key.pem',
    expectedApiUid,
  );
  requireCertificate(
    root,
    'secrets/wechat_platform_certificate.pem',
    expectedApiUid,
    env.WECHAT_PAY_PLATFORM_SERIAL_NO,
  );
  requireSecret(root, 'secrets/backup_passphrase', null, 32);

  const composeVersion = run('docker', [
    'compose',
    'version',
    '--short',
  ]).trim();
  if (!/(?:^|\D)v?2\./i.test(composeVersion)) {
    throw new Error('Docker Compose v2 is required');
  }
  run('docker', [
    'compose',
    '--env-file',
    envFile,
    '-f',
    'docker-compose.production.yml',
    'config',
    '--quiet',
  ]);
  log('Production preflight passed: environment, secrets, Compose v2, and topology.');
  return { composeVersion };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const root = process.cwd();
  const envFile = optionValue('--env-file') ?? '.env.production';
  const fileEnv = readEnvFile(path.resolve(root, envFile));
  await preflightProduction({
    env: { ...fileEnv, ...process.env },
    root,
    envFile,
    apiRuntimeUid: 1000,
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
