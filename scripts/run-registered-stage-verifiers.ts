import { spawnSync } from 'node:child_process';
import { GLOBAL_STATIC_VERIFIERS, STAGE_REGISTRY } from './stage-registry.ts';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = arg('stage');
const from = arg('from');
const to = arg('to');

function runVerifier(title: string, file: string): void {
  const result = spawnSync('pnpm', ['exec', 'tsx', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${title} failed`);
  console.log(`command_completed:${title}=true`);
}

for (const file of GLOBAL_STATIC_VERIFIERS) runVerifier(`Global static verifier ${file}`, file);

let stages = [...STAGE_REGISTRY];
if (only) stages = stages.filter((stage) => stage.id === only);
if (from) stages = stages.filter((stage) => stage.number >= Number(from.slice(1)));
if (to) stages = stages.filter((stage) => stage.number <= Number(to.slice(1)));
if (!stages.length) throw new Error('No registered stages selected');

for (const stage of stages) {
  runVerifier(`${stage.id} verifier`, stage.verifier);
  for (const file of stage.additionalVerifiers ?? []) runVerifier(`${stage.id} additional verifier`, file);
}
