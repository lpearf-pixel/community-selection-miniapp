import { readFileSync, existsSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string) {
  return readFileSync(path, 'utf8');
}

const generatePath = 'scripts/generate-stage-report.ts';
const publishPath = 'scripts/publish-stage-report.ts';
const docsPath = 'docs/dev/reporting.md';
const verifyAllPath = 'scripts/verify-all-local.sh';

assert(existsSync(generatePath), 'generate-stage-report.ts should exist');
assert(existsSync(publishPath), 'publish-stage-report.ts should exist');
assert(existsSync(docsPath), 'docs/dev/reporting.md should exist');

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(packageJson.scripts?.['report:stage'] === 'tsx scripts/generate-stage-report.ts', 'package.json should expose report:stage');
assert(packageJson.scripts?.['report:publish'] === 'tsx scripts/publish-stage-report.ts', 'package.json should expose report:publish');

const publishSource = read(publishPath);
for (const required of ['stage-reports', 'worktree', 'latest.md', 'latest-verify-output.txt', 'metadata.json', '--push', '--no-push']) {
  assert(publishSource.includes(required), `publish script should include ${required}`);
}
assert(!publishSource.includes('git checkout stage-reports'), 'publish script must not directly checkout the report branch in the current worktree');
assert(!publishSource.includes('git switch stage-reports'), 'publish script must not directly switch the current worktree');
assert(publishSource.includes('--orphan'), 'publish script may initialize the report branch through an orphan worktree');

const verifyAll = read(verifyAllPath);
assert(verifyAll.includes('pnpm exec tsx scripts/verify-report-publish-local.ts'), 'verify-all should include report publish verifier');

console.log('Report publish verification passed.');
