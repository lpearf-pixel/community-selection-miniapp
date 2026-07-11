import { existsSync, readFileSync } from 'node:fs';

const workflow = readFileSync('scripts/stage-workflow.ts', 'utf8');
const required = [
  'verify-l39-delivery-refund-finance-baseline-local.ts',
  'verify-docker-api-e2e-local.ts',
  'verify-admin-type-baseline-local.ts',
  '--typecheck-mode=baseline',
  '--typecheck-mode=full',
  '--typecheck-mode=off'
];
const missing = required.filter((text) => !workflow.includes(text));
if (!existsSync('scripts/lib/verification-result.ts')) missing.push('scripts/lib/verification-result.ts');
if (!existsSync('scripts/baselines/admin-typecheck-errors.txt')) missing.push('scripts/baselines/admin-typecheck-errors.txt');
if (missing.length > 0) {
  console.error(`Stage registry verification failed. Missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Stage registry verification passed.');
