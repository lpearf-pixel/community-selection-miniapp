import { existsSync, readFileSync } from 'node:fs';
import {
  STAGE_REGISTRY,
  assertStageRegistryFiles,
  getStageChain,
  getStageDefinition,
  latestRegisteredStage,
  registeredStageIds,
} from './stage-registry.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

assert(new Set(registeredStageIds()).size === STAGE_REGISTRY.length, 'stage IDs must be unique');
assert(
  STAGE_REGISTRY.every((stage, index) => index === 0 || stage.number > STAGE_REGISTRY[index - 1].number),
  'stage numbers must be monotonic',
);
assertStageRegistryFiles();
assert(latestRegisteredStage().id === 'L48', 'L48 must be latest registered stage');
assert(
  ['L44', 'L45', 'L46', 'L47', 'L48'].every((id) => getStageChain('L48').includes(id)),
  'L48 chain must include L44/L45/L46/L47/L48',
);
assert(getStageChain('L48')[0] === 'L48', 'L48 chain must start with L48');
assert(getStageChain('L48').at(-1) === 'L24', 'L48 chain must end with L24');

for (const file of [
  'scripts/stage-workflow.ts',
  'scripts/generate-stage-report.ts',
  'scripts/verify-report-publish-local.ts',
]) {
  assert(readFileSync(file, 'utf8').includes('stage-registry.ts'), `${file} must import registry`);
}

assert(!existsSync('scripts/l46-stage-registry.ts'), 'second L46 registry is forbidden');
assert(!existsSync('scripts/l47-stage-registry.ts'), 'second L47 registry is forbidden');
assert(!existsSync('scripts/l48-stage-registry.ts'), 'second L48 registry is forbidden');

const registrySource = readFileSync('scripts/stage-registry.ts', 'utf8');
assert(!registrySource.includes('readdirSync'), 'registry must not auto-discover verifiers');
assert(
  STAGE_REGISTRY.map((stage) => stage.number).every((number, index) => number === 24 + index),
  'L24-L48 numbers must be continuous',
);
assert(
  getStageDefinition('L46')?.additionalVerifiers?.includes('scripts/verify-l46-tax-record-db-scope-local.ts'),
  'L46 additional verifier missing',
);

const l47 = getStageDefinition('L47');
assert(l47, 'L47 definition missing');
assert(
  l47.additionalVerifiers?.includes('scripts/run-l47-center-docker-api-e2e-local.ts'),
  'L47 focused center Docker E2E missing',
);
assert(
  l47.additionalVerifiers?.includes('scripts/verify-l47-report-routing-local.ts'),
  'L47 report routing verifier missing',
);
assert(l47.runtimeMarkers?.length === 10, 'L47 runtime marker registry must contain ten markers');
assert(
  l47.reportContract?.businessBaseBranch === 'stable/l46-business-base',
  'L47 report base branch mismatch',
);
assert(
  l47.reportContract?.businessBaseCommit === 'dbb25ca2cf2e6d91af69a24454120f006a9422b0',
  'L47 report base commit mismatch',
);

const l48 = getStageDefinition('L48');
assert(l48, 'L48 definition missing');
assert(l48.title === 'Security and Privacy Hardening', 'L48 title mismatch');
assert(
  l48.additionalVerifiers?.includes('scripts/run-l48-security-privacy-docker-e2e-local.ts'),
  'L48 isolated security privacy E2E missing',
);
assert(
  l48.additionalVerifiers?.includes('scripts/verify-l48-report-routing-local.ts'),
  'L48 report routing verifier missing',
);
assert(l48.runtimeMarkers?.length === 10, 'L48 runtime marker registry must contain ten markers');
assert(
  l48.reportContract?.businessBaseBranch === 'stable/l47-business-base',
  'L48 report base branch mismatch',
);
assert(
  l48.reportContract?.businessBaseCommit === '030d06aebe75373600338a2eff92f4fb8e25a607',
  'L48 report base commit mismatch',
);

assert(
  readFileSync('scripts/run-registered-stage-verifiers.ts', 'utf8').includes('stage-registry.ts'),
  'runner must import registry',
);
const verifyAll = readFileSync('scripts/verify-all-local.sh', 'utf8');
assert(
  verifyAll.includes('run-registered-stage-verifiers.ts') &&
    !/verify-l(2[4-9]|3\d|4[0-8]).*-local\.ts/.test(verifyAll),
  'verify-all must use runner only for L24-L48',
);

console.log('Stage registry checks passed.');
