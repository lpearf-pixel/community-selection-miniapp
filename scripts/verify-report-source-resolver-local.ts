import { readFileSync } from 'node:fs';
import { getStageDefinition } from './stage-registry.ts';
import { resolveReportSource } from './stage-report-source.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(callback: () => unknown, expectedMessage: string): void {
  let actualError: unknown;
  try {
    callback();
  } catch (error) {
    actualError = error;
  }
  assert(actualError instanceof Error, `Expected error containing: ${expectedMessage}`);
  assert(
    actualError.message.includes(expectedMessage),
    [`Expected error containing: ${expectedMessage}`, `Actual: ${actualError.message}`].join('\n'),
  );
}

function verifyRegistrySource(stageId: 'L45' | 'L46' | 'L47'): void {
  const definition = getStageDefinition(stageId);
  assert(definition, `${stageId} must be registered`);
  assert(definition.reportContract, `${stageId} report contract must be registered`);
  const source = resolveReportSource(stageId);
  assert(source.sourceMode === 'git_diff', `${stageId} source must use git_diff`);
  assert(
    source.businessBaseBranch === definition.reportContract.businessBaseBranch,
    `${stageId} resolver branch must match registry`,
  );
  assert(
    source.businessBaseCommit === definition.reportContract.businessBaseCommit,
    `${stageId} resolver commit must match registry`,
  );
}

verifyRegistrySource('L45');
verifyRegistrySource('L46');
verifyRegistrySource('L47');

const l25LegacySource = resolveReportSource('L25', {});
assert(l25LegacySource.sourceMode === 'legacy_manifest', 'L25 must support manifest-only legacy source');
assert(l25LegacySource.businessBaseBranch === undefined, 'L25 legacy source must not invent a branch');
assert(l25LegacySource.businessBaseCommit === undefined, 'L25 legacy source must not invent a commit');

assertThrows(() => resolveReportSource('L25'), 'has no report source contract or legacy manifest');
assertThrows(
  () => resolveReportSource('L25', { businessBaseBranch: '   ' }),
  'businessBaseBranch must not be blank',
);
assertThrows(
  () => resolveReportSource('L25', { businessBaseCommit: '   ' }),
  'businessBaseCommit must not be blank',
);
assertThrows(() => resolveReportSource('L99', {}), 'is not registered');

const resolverSource = readFileSync('scripts/stage-report-source.ts', 'utf8');
for (const forbidden of ['HEAD~1', 'HEAD^', 'git diff', 'gitDiff', 'merge-base']) {
  assert(!resolverSource.includes(forbidden), `Report source resolver must not contain ${forbidden}`);
}
assert(!/\b[0-9a-f]{40}\b/i.test(resolverSource), 'Report source resolver must not hardcode commit SHAs');

console.log('Report source resolver checks passed.');
