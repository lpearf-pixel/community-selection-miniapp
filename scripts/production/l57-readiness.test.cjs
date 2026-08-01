const assert = require('node:assert/strict');
const test = require('node:test');

const readinessModule = import('./l57-readiness.mjs').catch(() => ({}));

const releaseSha = 'ac5c7cce158f5314db976ff2d130185292c46cad';
const publicIpv4 = '8.8.8.8';

const validEnv = {
  TENCENT_CLOUD_REGION: 'ap-shanghai',
  TENCENT_CLOUD_INSTANCE_ID: 'ins-l57prod01',
  TENCENT_CLOUD_INSTANCE_TYPE: 'S5.LARGE8',
  IMAGE_TAG: releaseSha,
  PRODUCTION_PUBLIC_IPV4: publicIpv4,
  API_DOMAIN: 'api.example.cn',
  ADMIN_DOMAIN: 'admin.example.cn',
};

const validHost = {
  platform: 'linux',
  osId: 'ubuntu',
  osVersionId: '24.04',
  arch: 'x64',
  cpuCores: 4,
  memoryMiB: 8192,
  diskGb: 100,
  gitClean: true,
};

const validCloudMetadata = {
  region: 'ap-shanghai',
  instanceId: 'ins-l57prod01',
  instanceType: 'S5.LARGE8',
  publicIpv4,
};

const validCloudApiInstance = {
  InstanceId: 'ins-l57prod01',
  InstanceType: 'S5.LARGE8',
  InstanceState: 'RUNNING',
  CPU: 4,
  Memory: 8,
  Placement: { Zone: 'ap-shanghai-5' },
  SystemDisk: { DiskSize: 100 },
  PublicIpAddresses: [publicIpv4],
  InternetAccessible: { InternetMaxBandwidthOut: 10 },
};

async function check(overrides = {}) {
  const { checkL57Readiness } = await readinessModule;
  assert.equal(
    typeof checkL57Readiness,
    'function',
    'l57-readiness.mjs must export checkL57Readiness',
  );
  return checkL57Readiness({
    env: { ...validEnv, ...overrides.env },
    host: { ...validHost, ...overrides.host },
    cloudMetadata: { ...validCloudMetadata, ...overrides.cloudMetadata },
    cloudApiInstance: {
      ...validCloudApiInstance,
      ...overrides.cloudApiInstance,
      Placement: {
        ...validCloudApiInstance.Placement,
        ...overrides.cloudApiInstance?.Placement,
      },
      SystemDisk: {
        ...validCloudApiInstance.SystemDisk,
        ...overrides.cloudApiInstance?.SystemDisk,
      },
      InternetAccessible: {
        ...validCloudApiInstance.InternetAccessible,
        ...overrides.cloudApiInstance?.InternetAccessible,
      },
    },
    gitHead: overrides.gitHead ?? releaseSha,
    resolve4:
      overrides.resolve4 ??
      (async () => [publicIpv4]),
  });
}

test('accepts the fixed Tencent Cloud Shanghai production target', async () => {
  const result = await check();

  assert.deepEqual(result, {
    region: 'ap-shanghai',
    releaseSha,
    apiDomain: 'api.example.cn',
    adminDomain: 'admin.example.cn',
    publicIpv4,
    instanceId: 'ins-l57prod01',
    instanceType: 'S5.LARGE8',
    publicBandwidthMbps: 10,
    os: 'ubuntu 24.04',
    cpuCores: 4,
    memoryMiB: 8192,
    diskGb: 100,
  });
});

test('binds configured region, instance, type, and public IP to Tencent metadata', async () => {
  await assert.rejects(
    check({ env: { TENCENT_CLOUD_REGION: 'ap-guangzhou' } }),
    /TENCENT_CLOUD_REGION must be ap-shanghai/,
  );
  for (const [key, value, message] of [
    ['region', 'ap-guangzhou', 'metadata region must match'],
    ['instanceId', 'ins-foreign01', 'metadata instance ID must match'],
    ['instanceType', 'S5.SMALL1', 'metadata instance type must match'],
    ['publicIpv4', '8.8.4.4', 'metadata public IPv4 must match'],
  ]) {
    await assert.rejects(
      check({ cloudMetadata: { [key]: value } }),
      new RegExp(message),
    );
  }
});

test('rejects a host below any approved resource floor', async () => {
  for (const [key, value, message] of [
    ['cpuCores', 3, 'at least 4 CPU cores'],
    ['memoryMiB', 7679, 'at least 7680 MiB usable memory'],
    ['diskGb', 99, 'at least 100 GB disk'],
  ]) {
    await assert.rejects(check({ host: { [key]: value } }), new RegExp(message));
  }
});

test('requires Ubuntu 22.04 or 24.04 and at least 10 Mbps purchased bandwidth', async () => {
  await assert.rejects(
    check({ host: { osId: 'debian', osVersionId: '12' } }),
    /Ubuntu 22.04 or 24.04/,
  );
  await assert.rejects(
    check({ host: { osVersionId: '20.04' } }),
    /Ubuntu 22.04 or 24.04/,
  );
  await assert.rejects(
    check({ cloudApiInstance: { InternetAccessible: { InternetMaxBandwidthOut: 9 } } }),
    /API must report at least 10 Mbps/,
  );
});

test('requires the read-only CVM API instance to match the approved production SKU', async () => {
  for (const [override, message] of [
    [{ InstanceId: 'ins-foreign01' }, 'API instance ID must match'],
    [{ InstanceType: 'S5.SMALL1' }, 'API instance type must match'],
    [{ InstanceState: 'STOPPED' }, 'API instance must be RUNNING'],
    [{ CPU: 2 }, 'API must report at least 4 CPU cores'],
    [{ Memory: 4 }, 'API must report at least 8 GiB memory'],
    [{ Placement: { Zone: 'ap-guangzhou-3' } }, 'API zone must be in ap-shanghai'],
    [{ SystemDisk: { DiskSize: 99 } }, 'API must report at least 100 GB system disk'],
    [{ PublicIpAddresses: ['8.8.4.4'] }, 'API public IPv4 must match'],
  ]) {
    await assert.rejects(check({ cloudApiInstance: override }), new RegExp(message));
  }
});

test('parses wrapped and top-level tccli output and always uses the CVM role', async () => {
  const { parseTencentCloudApiOutput, readTencentCloudApiInstance } = await readinessModule;
  assert.equal(typeof parseTencentCloudApiOutput, 'function');
  assert.equal(typeof readTencentCloudApiInstance, 'function');

  for (const payload of [
    { Response: { TotalCount: 1, InstanceSet: [validCloudApiInstance] } },
    { TotalCount: 1, InstanceSet: [validCloudApiInstance] },
  ]) {
    assert.deepEqual(parseTencentCloudApiOutput(JSON.stringify(payload)), validCloudApiInstance);
  }
  assert.throws(
    () => parseTencentCloudApiOutput(JSON.stringify({ TotalCount: 0, InstanceSet: [] })),
    /exactly one instance/,
  );

  let invocation;
  const instance = readTencentCloudApiInstance(validEnv, (command, args, options) => {
    invocation = { command, args, options };
    return JSON.stringify({ TotalCount: 1, InstanceSet: [validCloudApiInstance] });
  });
  assert.deepEqual(instance, validCloudApiInstance);
  assert.equal(invocation.command, 'tccli');
  assert.deepEqual(invocation.args.slice(0, 2), ['cvm', 'DescribeInstances']);
  assert.ok(invocation.args.includes('--use-cvm-role'));
  assert.ok(invocation.args.includes('--output'));
  assert.ok(invocation.args.includes('json'));
  assert.ok(invocation.args.includes(JSON.stringify([validEnv.TENCENT_CLOUD_INSTANCE_ID])));
  assert.equal(invocation.options.timeout, 15_000);
});

test('rejects release SHA drift and a dirty checkout', async () => {
  await assert.rejects(
    check({ gitHead: '52db733000000000000000000000000000000000' }),
    /IMAGE_TAG must exactly match Git HEAD/,
  );
  await assert.rejects(
    check({ host: { gitClean: false } }),
    /production checkout must be clean/,
  );
});

test('rejects private addresses and production DNS drift', async () => {
  await assert.rejects(
    check({ env: { PRODUCTION_PUBLIC_IPV4: '10.0.0.8' } }),
    /PRODUCTION_PUBLIC_IPV4 must be a public IPv4 address/,
  );
  await assert.rejects(
    check({ resolve4: async (domain) => domain.startsWith('api.') ? [publicIpv4] : ['8.8.4.4'] }),
    /ADMIN_DOMAIN must resolve to PRODUCTION_PUBLIC_IPV4/,
  );
  await assert.rejects(
    check({ resolve4: async () => [publicIpv4, '8.8.4.4'] }),
    /must resolve only to PRODUCTION_PUBLIC_IPV4/,
  );
});

test('rejects non-Linux and unsupported architectures', async () => {
  await assert.rejects(
    check({ host: { platform: 'darwin' } }),
    /production host must run Linux/,
  );
  await assert.rejects(
    check({ host: { arch: 'ia32' } }),
    /production architecture must be x64 or arm64/,
  );
});
