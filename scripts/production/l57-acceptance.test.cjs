const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deflateSync } = require('node:zlib');

const acceptanceModule = import('./l57-acceptance.mjs').catch(() => ({}));
const root = path.resolve(__dirname, '../..');
const releaseSha = '6bbd364000000000000000000000000000000000';
const coreScenarioIds = [
  'P01', 'P02', 'P03', 'P04',
  'G01', 'G02', 'G03', 'G04', 'G05',
  'R01', 'F01', 'A01', 'A02', 'O01', 'O02', 'B01', 'B02', 'M00',
];

function scenario(id) {
  return {
    id,
    executedAt: '2026-07-31T18:00:00.000Z',
    result: 'passed',
    orderSuffix: ['P01', 'A01', 'A02', 'O01', 'O02', 'B01', 'B02', 'M00'].includes(id)
      ? null
      : 'A1B2',
    evidenceRefs: [`screenshots/${id}.png`],
    notes: `${id} redacted acceptance evidence`,
  };
}

function manifest(overrides = {}) {
  return {
    version: 1,
    releaseSha,
    phase: 'core_gray',
    operatorAlias: 'ops-01',
    scenarios: coreScenarioIds.map(scenario),
    ...overrides,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function minimalPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function validate(value, expectedSha = releaseSha) {
  const { validateAcceptanceManifest } = await acceptanceModule;
  assert.equal(
    typeof validateAcceptanceManifest,
    'function',
    'l57-acceptance.mjs must export validateAcceptanceManifest',
  );
  return validateAcceptanceManifest(value, expectedSha);
}

test('accepts a complete redacted core gray manifest', async () => {
  const result = await validate(manifest());

  assert.deepEqual(result, {
    phase: 'core_gray',
    releaseSha,
    passedCount: coreScenarioIds.length,
    requiredCount: coreScenarioIds.length,
  });
});

test('rejects missing, duplicate, failed, or drifted core evidence', async () => {
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.slice(1).map(scenario) })),
    /missing required scenario P01/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: [...coreScenarioIds.map(scenario), scenario('P01')] })),
    /duplicate scenario P01/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'R01' ? { ...scenario(id), result: 'failed' } : scenario(id)) })),
    /scenario R01 must be passed/,
  );
  await assert.rejects(
    validate(manifest({ releaseSha: '52db733000000000000000000000000000000000' })),
    /releaseSha must match the deployed candidate/,
  );
});

test('rejects full identifiers, secret material, and unsafe evidence paths', async () => {
  await assert.rejects(
    validate(manifest({ orderId: 'order-1234567890' })),
    /unsupported manifest field orderId/,
  );
  await assert.rejects(
    validate(manifest({ sessionToken: 'secret-value' })),
    /unsupported manifest field sessionToken/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P02' ? { ...scenario(id), orderSuffix: 'ORDER-123456' } : scenario(id)) })),
    /orderSuffix must contain exactly four/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P03' ? { ...scenario(id), evidenceRefs: ['../raw-notify.json'] } : scenario(id)) })),
    /evidenceRefs must use redacted scenario paths/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P04' ? { ...scenario(id), notes: '-----BEGIN PRIVATE KEY-----' } : scenario(id)) })),
    /notes contain forbidden secret material/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P01' ? { ...scenario(id), evidenceRefs: ['screenshots/session_token_secret.png'] } : scenario(id)) })),
    /evidenceRefs must use redacted scenario paths/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P02' ? { ...scenario(id), notes: 'full order order-12345678901234567890' } : scenario(id)) })),
    /notes contain forbidden identifiers or payload material/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P03' ? { ...scenario(id), notes: '{"callback_body":{"transaction_id":"420000123456789"}}' } : scenario(id)) })),
    /notes contain forbidden (?:secret|identifiers)/,
  );
  for (const leakedValue of [
    'O17539876543211234',
    'PAYABCDEF0123456789ABCDEF012345678',
    'oAbCdEfGhIjKlMnOpQrStUvWxYz1',
    '550e8400-e29b-41d4-a716-446655440000',
  ]) {
    await assert.rejects(
      validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P04' ? { ...scenario(id), notes: leakedValue } : scenario(id)) })),
      /notes contain forbidden identifiers or payload material/,
    );
  }
});

test('only accepts evidence references named for the scenario', async () => {
  const result = await validate(manifest({
    scenarios: coreScenarioIds.map((id) => id === 'P01'
      ? { ...scenario(id), evidenceRefs: ['screenshots/P01-01.png'] }
      : scenario(id)),
  }));
  assert.equal(result.phase, 'core_gray');

  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'P01' ? { ...scenario(id), evidenceRefs: ['screenshots/G01.png'] } : scenario(id)) })),
    /evidenceRefs must use redacted scenario paths/,
  );
});

test('real acceptance manifests and screenshots are ignored while the example stays tracked', () => {
  const realManifest = spawnSync('git', ['check-ignore', '-q', 'deploy/l57/acceptance.real.json'], {
    cwd: root,
  });
  const screenshot = spawnSync('git', ['check-ignore', '-q', 'deploy/l57/screenshots/P01.png'], {
    cwd: root,
  });
  const example = spawnSync('git', ['check-ignore', '-q', 'deploy/l57/acceptance.example.json'], {
    cwd: root,
  });

  assert.equal(realManifest.status, 0, 'populated acceptance JSON must be ignored');
  assert.equal(screenshot.status, 0, 'acceptance screenshots must be ignored');
  assert.notEqual(example.status, 0, 'redacted example must remain trackable');
});

test('requires real regular PNG evidence beside the manifest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l57-acceptance-'));
  const screenshots = path.join(directory, 'screenshots');
  fs.mkdirSync(screenshots);
  const value = manifest();
  const manifestFile = path.join(directory, 'acceptance.json');
  fs.writeFileSync(manifestFile, JSON.stringify(value));
  const validPng = minimalPng();
  for (const id of coreScenarioIds) {
    fs.writeFileSync(path.join(screenshots, `${id}.png`), validPng);
  }

  const { validateAcceptanceEvidenceFiles } = await acceptanceModule;
  assert.equal(typeof validateAcceptanceEvidenceFiles, 'function');
  assert.equal(validateAcceptanceEvidenceFiles(value, manifestFile), coreScenarioIds.length);

  fs.unlinkSync(path.join(screenshots, 'P01.png'));
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /P01 evidence file must exist/,
  );
  fs.writeFileSync(path.join(screenshots, 'P01.png'), 'not a png');
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /P01 evidence file must be a PNG/,
  );
  fs.writeFileSync(path.join(screenshots, 'P01.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /P01 evidence file must be a valid PNG/,
  );
  const badCrc = Buffer.from(validPng);
  badCrc[29] ^= 0xff;
  fs.writeFileSync(path.join(screenshots, 'P01.png'), badCrc);
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /P01 evidence file must be a valid PNG/,
  );
  fs.unlinkSync(path.join(screenshots, 'P01.png'));
  fs.symlinkSync(path.join(screenshots, 'P02.png'), path.join(screenshots, 'P01.png'));
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /P01 evidence file must be a regular file/,
  );

  const linkedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'l57-linked-evidence-'));
  fs.rmSync(screenshots, { recursive: true, force: true });
  fs.symlinkSync(linkedDirectory, screenshots);
  assert.throws(
    () => validateAcceptanceEvidenceFiles(value, manifestFile),
    /screenshots directory must be a regular directory/,
  );
});

test('requires L56 membership and gift evidence in membership gray phase', async () => {
  const membershipIds = ['M01', 'M02', 'M03', 'M04'];
  await assert.rejects(
    validate(manifest({
      phase: 'membership_gray',
      scenarios: coreScenarioIds.filter((id) => id !== 'M00').map(scenario),
    })),
    /missing required scenario M01/,
  );

  const result = await validate(manifest({
    phase: 'membership_gray',
    scenarios: [
      ...coreScenarioIds.filter((id) => id !== 'M00').map(scenario),
      ...membershipIds.map(scenario),
    ],
  }));
  assert.equal(result.phase, 'membership_gray');
  assert.equal(result.requiredCount, coreScenarioIds.length - 1 + membershipIds.length);
});

test('rejects malformed timestamps and unapproved phases', async () => {
  await assert.rejects(
    validate(manifest({ phase: 'full_release' })),
    /phase must be core_gray or membership_gray/,
  );
  await assert.rejects(
    validate(manifest({ scenarios: coreScenarioIds.map((id) => id === 'G01' ? { ...scenario(id), executedAt: 'yesterday' } : scenario(id)) })),
    /executedAt must be an ISO UTC timestamp/,
  );
});
