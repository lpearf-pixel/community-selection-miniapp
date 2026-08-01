import { execFileSync } from 'node:child_process';
import { resolve4 as resolveIpv4 } from 'node:dns/promises';
import { readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvFile } from './preflight.mjs';

function isPublicIpv4(value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const bytes = parts.map(Number);
  if (bytes.some((byte) => byte < 0 || byte > 255)) return false;
  const [a, b, c] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

async function requireDomainAddress(resolve4, domain, expectedAddress, label) {
  let addresses;
  try {
    addresses = await resolve4(domain);
  } catch {
    throw new Error(`${label} must resolve to PRODUCTION_PUBLIC_IPV4`);
  }
  const uniqueAddresses = [...new Set(addresses)];
  if (uniqueAddresses.length !== 1 || uniqueAddresses[0] !== expectedAddress) {
    if (uniqueAddresses.includes(expectedAddress)) {
      throw new Error(`${label} must resolve only to PRODUCTION_PUBLIC_IPV4`);
    }
    throw new Error(`${label} must resolve to PRODUCTION_PUBLIC_IPV4`);
  }
}

export async function checkL57Readiness({ env, host, cloudMetadata, cloudApiInstance, resolve4, gitHead }) {
  if (env.TENCENT_CLOUD_REGION !== 'ap-shanghai') {
    throw new Error('TENCENT_CLOUD_REGION must be ap-shanghai');
  }
  if (host.platform !== 'linux') {
    throw new Error('production host must run Linux');
  }
  if (host.osId !== 'ubuntu' || !['22.04', '24.04'].includes(host.osVersionId)) {
    throw new Error('production host must run Ubuntu 22.04 or 24.04');
  }
  if (!['x64', 'arm64'].includes(host.arch)) {
    throw new Error('production architecture must be x64 or arm64');
  }
  if (!Number.isInteger(host.cpuCores) || host.cpuCores < 4) {
    throw new Error('production host requires at least 4 CPU cores');
  }
  if (!Number.isFinite(host.memoryMiB) || host.memoryMiB < 7680) {
    throw new Error('production host requires at least 7680 MiB usable memory');
  }
  if (!Number.isFinite(host.diskGb) || host.diskGb < 100) {
    throw new Error('production host requires at least 100 GB disk');
  }
  if (!/^[a-f0-9]{40}$/i.test(env.IMAGE_TAG ?? '') || env.IMAGE_TAG !== gitHead) {
    throw new Error('IMAGE_TAG must exactly match Git HEAD');
  }
  if (!host.gitClean) {
    throw new Error('production checkout must be clean');
  }
  if (!isPublicIpv4(env.PRODUCTION_PUBLIC_IPV4)) {
    throw new Error('PRODUCTION_PUBLIC_IPV4 must be a public IPv4 address');
  }
  if (!/^ins-[a-z0-9]{8,}$/i.test(env.TENCENT_CLOUD_INSTANCE_ID ?? '')) {
    throw new Error('TENCENT_CLOUD_INSTANCE_ID must be a valid Tencent CVM instance ID');
  }
  if (!/^[A-Z0-9][A-Z0-9.-]{2,63}$/i.test(env.TENCENT_CLOUD_INSTANCE_TYPE ?? '')) {
    throw new Error('TENCENT_CLOUD_INSTANCE_TYPE must be configured');
  }
  if (cloudMetadata?.region !== env.TENCENT_CLOUD_REGION) {
    throw new Error('Tencent metadata region must match TENCENT_CLOUD_REGION');
  }
  if (cloudMetadata?.instanceId !== env.TENCENT_CLOUD_INSTANCE_ID) {
    throw new Error('Tencent metadata instance ID must match TENCENT_CLOUD_INSTANCE_ID');
  }
  if (cloudMetadata?.instanceType !== env.TENCENT_CLOUD_INSTANCE_TYPE) {
    throw new Error('Tencent metadata instance type must match TENCENT_CLOUD_INSTANCE_TYPE');
  }
  if (cloudMetadata?.publicIpv4 !== env.PRODUCTION_PUBLIC_IPV4) {
    throw new Error('Tencent metadata public IPv4 must match PRODUCTION_PUBLIC_IPV4');
  }
  if (cloudApiInstance?.InstanceId !== env.TENCENT_CLOUD_INSTANCE_ID) {
    throw new Error('Tencent API instance ID must match TENCENT_CLOUD_INSTANCE_ID');
  }
  if (cloudApiInstance?.InstanceType !== env.TENCENT_CLOUD_INSTANCE_TYPE) {
    throw new Error('Tencent API instance type must match TENCENT_CLOUD_INSTANCE_TYPE');
  }
  if (cloudApiInstance?.InstanceState !== 'RUNNING') {
    throw new Error('Tencent API instance must be RUNNING');
  }
  if (!Number.isInteger(cloudApiInstance?.CPU) || cloudApiInstance.CPU < 4) {
    throw new Error('Tencent API must report at least 4 CPU cores');
  }
  if (!Number.isInteger(cloudApiInstance?.Memory) || cloudApiInstance.Memory < 8) {
    throw new Error('Tencent API must report at least 8 GiB memory');
  }
  if (!String(cloudApiInstance?.Placement?.Zone ?? '').startsWith(`${env.TENCENT_CLOUD_REGION}-`)) {
    throw new Error('Tencent API zone must be in ap-shanghai');
  }
  if (!Number.isInteger(cloudApiInstance?.SystemDisk?.DiskSize) || cloudApiInstance.SystemDisk.DiskSize < 100) {
    throw new Error('Tencent API must report at least 100 GB system disk');
  }
  const apiPublicAddresses = [...new Set(cloudApiInstance?.PublicIpAddresses ?? [])];
  if (apiPublicAddresses.length !== 1 || apiPublicAddresses[0] !== env.PRODUCTION_PUBLIC_IPV4) {
    throw new Error('Tencent API public IPv4 must match PRODUCTION_PUBLIC_IPV4');
  }
  const publicBandwidthMbps = cloudApiInstance?.InternetAccessible?.InternetMaxBandwidthOut;
  if (!Number.isInteger(publicBandwidthMbps) || publicBandwidthMbps < 10) {
    throw new Error('Tencent API must report at least 10 Mbps public bandwidth');
  }
  await requireDomainAddress(
    resolve4,
    env.API_DOMAIN,
    env.PRODUCTION_PUBLIC_IPV4,
    'API_DOMAIN',
  );
  await requireDomainAddress(
    resolve4,
    env.ADMIN_DOMAIN,
    env.PRODUCTION_PUBLIC_IPV4,
    'ADMIN_DOMAIN',
  );

  return {
    region: env.TENCENT_CLOUD_REGION,
    releaseSha: env.IMAGE_TAG,
    apiDomain: env.API_DOMAIN,
    adminDomain: env.ADMIN_DOMAIN,
    publicIpv4: env.PRODUCTION_PUBLIC_IPV4,
    instanceId: cloudMetadata.instanceId,
    instanceType: cloudMetadata.instanceType,
    publicBandwidthMbps,
    os: `${host.osId} ${host.osVersionId}`,
    cpuCores: host.cpuCores,
    memoryMiB: host.memoryMiB,
    diskGb: host.diskGb,
  };
}

function parseOsRelease(contents) {
  return Object.fromEntries(
    contents
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=');
        const value = line.slice(separator + 1).replace(/^['"]|['"]$/g, '');
        return [line.slice(0, separator), value];
      }),
  );
}

async function readTencentMetadata() {
  const base = 'http://metadata.tencentyun.com/latest/meta-data/';
  const entries = {
    region: 'placement/region',
    instanceId: 'instance-id',
    instanceType: 'instance/instance-type',
    publicIpv4: 'public-ipv4',
  };
  try {
    const pairs = await Promise.all(Object.entries(entries).map(async ([key, endpoint]) => {
      const response = await fetch(`${base}${endpoint}`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
      return [key, (await response.text()).trim()];
    }));
    return Object.fromEntries(pairs);
  } catch (error) {
    throw new Error(`Tencent instance metadata is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseTencentCloudApiOutput(output) {
  const parsed = JSON.parse(output);
  const response = parsed?.Response ?? parsed;
  if (response?.TotalCount !== 1 || response?.InstanceSet?.length !== 1) {
    throw new Error('expected exactly one instance');
  }
  return response.InstanceSet[0];
}

export function readTencentCloudApiInstance(env, execFile = execFileSync) {
  try {
    const output = execFile('tccli', [
      'cvm',
      'DescribeInstances',
      '--region', env.TENCENT_CLOUD_REGION,
      '--InstanceIds', JSON.stringify([env.TENCENT_CLOUD_INSTANCE_ID]),
      '--use-cvm-role',
      '--output', 'json',
    ], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseTencentCloudApiOutput(output);
  } catch (error) {
    throw new Error(`Tencent read-only CVM API check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readHostFacts(root) {
  const filesystem = statfsSync(root);
  const diskBytes = Number(filesystem.bsize) * Number(filesystem.blocks);
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  });
  const osRelease = parseOsRelease(readFileSync('/etc/os-release', 'utf8'));
  return {
    platform: os.platform(),
    osId: osRelease.ID,
    osVersionId: osRelease.VERSION_ID,
    arch: os.arch(),
    cpuCores: os.cpus().length,
    memoryMiB: Math.floor(os.totalmem() / 1024 / 1024),
    diskGb: Math.floor(diskBytes / 1_000_000_000),
    gitClean: status.trim() === '',
  };
}

async function main() {
  const root = process.cwd();
  const envFile = optionValue('--env-file') ?? process.env.ENV_FILE ?? '.env.production';
  const env = { ...readEnvFile(path.resolve(root, envFile)), ...process.env };
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const result = await checkL57Readiness({
    env,
    host: readHostFacts(root),
    cloudMetadata: await readTencentMetadata(),
    cloudApiInstance: readTencentCloudApiInstance(env),
    resolve4: resolveIpv4,
    gitHead,
  });
  console.log(
    `L57 readiness passed: ${result.region}, ${result.instanceId}, ${result.instanceType}, ${result.releaseSha}, ${result.cpuCores} CPU, ${result.memoryMiB} MiB, ${result.diskGb} GB, ${result.publicBandwidthMbps} Mbps.`,
  );
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
