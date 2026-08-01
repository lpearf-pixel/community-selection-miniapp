import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const commonScenarioIds = [
  'P01', 'P02', 'P03', 'P04',
  'G01', 'G02', 'G03', 'G04', 'G05',
  'R01', 'F01', 'A01', 'A02', 'O01', 'O02', 'B01', 'B02',
];
const manifestFields = new Set([
  'version',
  'releaseSha',
  'phase',
  'operatorAlias',
  'scenarios',
]);
const scenarioFields = new Set([
  'id',
  'executedAt',
  'result',
  'orderSuffix',
  'evidenceRefs',
  'notes',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function rejectUnknownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unsupported ${label} field ${key}`);
  }
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

const secretMaterialPattern = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----|\bopenid\b|session[_ -]?token|api[_ -]?v3|callback[_ -]?body/i;
const identifierOrPayloadPattern = /\b(?:order|transaction|payment|refund|out[_ -]?trade)[_:# -]?[A-Za-z0-9-]{10,}\b|\bO\d{16,}\b|\bPAY[A-Za-z0-9]{20,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b[A-Za-z0-9_-]{20,}\b|\b\d{10,}\b|[{}]/i;

function forbiddenEvidenceReason(value) {
  if (typeof value !== 'string') return 'invalid';
  if (secretMaterialPattern.test(value)) return 'secret';
  if (identifierOrPayloadPattern.test(value)) return 'identifier';
  return null;
}

function isScenarioEvidencePath(value, scenarioId) {
  if (forbiddenEvidenceReason(value)) return false;
  return new RegExp(`^screenshots/${scenarioId}(?:-[0-9]{2})?\\.png$`).test(value);
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

function validatePngStructure(buffer) {
  if (buffer.length > 25 * 1024 * 1024) throw new Error('PNG is too large');
  let offset = 8;
  let ihdr;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  const idatParts = [];
  while (offset < buffer.length) {
    if (buffer.length - offset < 12) throw new Error('truncated PNG chunk');
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw new Error('truncated PNG data');
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('invalid PNG chunk type');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) {
      throw new Error('invalid PNG CRC');
    }
    if (offset === 8 && type !== 'IHDR') throw new Error('IHDR must be first');
    if (type === 'IHDR') {
      if (ihdr || length !== 13) throw new Error('invalid IHDR');
      ihdr = data;
    } else if (type === 'IDAT') {
      if (!ihdr || endedIdat) throw new Error('invalid IDAT ordering');
      sawIdat = true;
      idatParts.push(data);
    } else if (sawIdat && type !== 'IEND') {
      endedIdat = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) throw new Error('invalid IEND');
      sawIend = true;
    }
    offset = chunkEnd;
  }
  if (!ihdr || !sawIdat || !sawIend) throw new Error('incomplete PNG');

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const validDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  }[colorType];
  if (
    width === 0 || height === 0 || width > 32768 || height > 32768 ||
    !channels || !validDepths?.includes(bitDepth) ||
    ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0
  ) {
    throw new Error('unsupported PNG image header');
  }
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedBytes = (rowBytes + 1) * height;
  if (expectedBytes > 100 * 1024 * 1024) throw new Error('decoded PNG is too large');
  const decoded = inflateSync(Buffer.concat(idatParts), { maxOutputLength: expectedBytes + 1 });
  if (decoded.length !== expectedBytes) throw new Error('invalid PNG pixel data');
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)] > 4) throw new Error('invalid PNG row filter');
  }
}

function validateScenario(scenario, allowedIds) {
  requireObject(scenario, 'scenario');
  rejectUnknownFields(scenario, scenarioFields, 'scenario');
  if (!allowedIds.has(scenario.id)) {
    throw new Error(`unexpected scenario ${String(scenario.id)}`);
  }
  if (!isUtcTimestamp(scenario.executedAt)) {
    throw new Error(`scenario ${scenario.id} executedAt must be an ISO UTC timestamp`);
  }
  if (scenario.result !== 'passed') {
    throw new Error(`scenario ${scenario.id} must be passed`);
  }
  if (
    scenario.orderSuffix !== null &&
    !/^[A-Za-z0-9]{4}$/.test(scenario.orderSuffix ?? '')
  ) {
    throw new Error(`scenario ${scenario.id} orderSuffix must contain exactly four letters or digits`);
  }
  if (
    !Array.isArray(scenario.evidenceRefs) ||
    scenario.evidenceRefs.length === 0 ||
    scenario.evidenceRefs.some((entry) => !isScenarioEvidencePath(entry, scenario.id))
  ) {
    throw new Error(`scenario ${scenario.id} evidenceRefs must use redacted scenario paths`);
  }
  if (typeof scenario.notes !== 'string' || scenario.notes.length > 500) {
    throw new Error(`scenario ${scenario.id} notes must be at most 500 characters`);
  }
  const forbiddenNotes = forbiddenEvidenceReason(scenario.notes);
  if (forbiddenNotes === 'secret') {
    throw new Error(`scenario ${scenario.id} notes contain forbidden secret material`);
  }
  if (forbiddenNotes === 'identifier') {
    throw new Error(`scenario ${scenario.id} notes contain forbidden identifiers or payload material`);
  }
}

export function validateAcceptanceManifest(manifest, expectedSha) {
  requireObject(manifest, 'manifest');
  rejectUnknownFields(manifest, manifestFields, 'manifest');
  if (manifest.version !== 1) throw new Error('version must be 1');
  if (!['core_gray', 'membership_gray'].includes(manifest.phase)) {
    throw new Error('phase must be core_gray or membership_gray');
  }
  if (!/^[a-f0-9]{40}$/i.test(expectedSha ?? '') || manifest.releaseSha !== expectedSha) {
    throw new Error('releaseSha must match the deployed candidate');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(manifest.operatorAlias ?? '')) {
    throw new Error('operatorAlias must be a redacted 3-32 character alias');
  }
  if (!Array.isArray(manifest.scenarios)) throw new Error('scenarios must be an array');

  const requiredIds = manifest.phase === 'core_gray'
    ? [...commonScenarioIds, 'M00']
    : [...commonScenarioIds, 'M01', 'M02', 'M03', 'M04'];
  const allowedIds = new Set(requiredIds);
  const seen = new Set();
  for (const scenario of manifest.scenarios) {
    if (seen.has(scenario?.id)) throw new Error(`duplicate scenario ${scenario.id}`);
    validateScenario(scenario, allowedIds);
    seen.add(scenario.id);
  }
  for (const id of requiredIds) {
    if (!seen.has(id)) throw new Error(`missing required scenario ${id}`);
  }

  return {
    phase: manifest.phase,
    releaseSha: manifest.releaseSha,
    passedCount: seen.size,
    requiredCount: requiredIds.length,
  };
}

export function validateAcceptanceEvidenceFiles(manifest, manifestFile) {
  const manifestDirectory = path.dirname(path.resolve(manifestFile));
  let realManifestDirectory;
  try {
    realManifestDirectory = fs.realpathSync(manifestDirectory);
  } catch {
    throw new Error('manifest directory must exist');
  }
  const screenshotsDirectory = path.join(manifestDirectory, 'screenshots');
  let screenshotsStat;
  try {
    screenshotsStat = fs.lstatSync(screenshotsDirectory);
  } catch {
    throw new Error('screenshots directory must exist');
  }
  if (screenshotsStat.isSymbolicLink() || !screenshotsStat.isDirectory()) {
    throw new Error('screenshots directory must be a regular directory');
  }
  const realScreenshotsDirectory = fs.realpathSync(screenshotsDirectory);
  if (realScreenshotsDirectory !== path.join(realManifestDirectory, 'screenshots')) {
    throw new Error('screenshots directory must stay beside the manifest');
  }
  let count = 0;
  for (const scenario of manifest.scenarios) {
    for (const reference of scenario.evidenceRefs) {
      const candidate = path.resolve(manifestDirectory, reference);
      let stat;
      try {
        stat = fs.lstatSync(candidate);
      } catch {
        throw new Error(`scenario ${scenario.id} evidence file must exist`);
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`scenario ${scenario.id} evidence file must be a regular file`);
      }
      const realCandidate = fs.realpathSync(candidate);
      if (!realCandidate.startsWith(`${realScreenshotsDirectory}${path.sep}`)) {
        throw new Error(`scenario ${scenario.id} evidence file must stay beside the manifest`);
      }
      const signature = fs.readFileSync(realCandidate).subarray(0, 8);
      if (!signature.equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        throw new Error(`scenario ${scenario.id} evidence file must be a PNG`);
      }
      try {
        validatePngStructure(fs.readFileSync(realCandidate));
      } catch {
        throw new Error(`scenario ${scenario.id} evidence file must be a valid PNG`);
      }
      count += 1;
    }
  }
  return count;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const file = optionValue('--file');
  const releaseSha = optionValue('--sha');
  if (!file) throw new Error('--file is required');
  if (!releaseSha) throw new Error('--sha is required');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const result = validateAcceptanceManifest(manifest, releaseSha);
  const evidenceCount = validateAcceptanceEvidenceFiles(manifest, file);
  console.log(
    `L57 acceptance passed: ${result.phase}, ${result.passedCount}/${result.requiredCount}, ${evidenceCount} evidence files, ${result.releaseSha}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
