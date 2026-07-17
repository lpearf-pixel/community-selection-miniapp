import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getStageChain, getStageDefinition, latestRegisteredStage as latestStageDefinition, STAGE_REGISTRY } from './stage-registry.ts';

type Scope = 'stage' | 'chain' | 'all';
type CommandSpec = {
  title: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  successMessage?: string;
};

type ParsedArgs = {
  stage?: string;
  verify: boolean;
  publish: boolean;
  push: boolean;
  all: boolean;
  debug: boolean;
  scope?: Scope;
  skipSourceSyncCheck: boolean;
};

const reportsDir = join(process.cwd(), 'reports');
const latestVerifyOutput = join(reportsDir, 'latest-verify-output.txt');

const stageVerifiers: Record<string, CommandSpec> = Object.fromEntries(STAGE_REGISTRY.map((stage) => [stage.id, { title: `${stage.id} verifier`, command: 'pnpm', args: ['exec', 'tsx', stage.verifier!] }]));
function additionalVerifierTitle(stageId: string, verifier: string): string {
  if (verifier === 'scripts/verify-l46-tax-record-db-scope-local.ts') return 'L46 tax-record DB scope verifier';
  return `${stageId} additional verifier`;
}
const stageAdditionalVerifiers: Record<string, CommandSpec[]> = Object.fromEntries(STAGE_REGISTRY.map((stage) => [stage.id, (stage.additionalVerifiers ?? []).map((verifier) => ({ title: additionalVerifierTitle(stage.id, verifier), command: 'pnpm', args: ['exec', 'tsx', verifier] }))]));
const regressionChains: Record<string, string[]> = Object.fromEntries(STAGE_REGISTRY.map((stage) => [stage.id, [...getStageChain(stage.id), ...(stage.number >= 43 ? ['RAW_COMPLIANCE_SCAN'] : []), ...(stage.number >= 38 ? ['DOCKER_API_E2E', 'ADMIN_TYPECHECK'] : [])]]));

const dockerApiE2E: CommandSpec = {
  title: 'Docker API E2E',
  command: 'pnpm',
  args: ['exec', 'tsx', 'scripts/verify-docker-api-e2e-local.ts', '--debug'],
  env: { API_BASE_URL: 'http://127.0.0.1:13080' }
};


const rawComplianceScan: CommandSpec = {
  title: 'raw compliance scan',
  command: 'pnpm',
  args: ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'],
  successMessage: 'raw compliance scan passed.'
};

const adminTypeConfigCheck: CommandSpec = {
  title: 'Admin typecheck config check',
  command: 'pnpm',
  args: ['exec', 'tsx', 'scripts/verify-admin-type-config-local.ts'],
  successMessage: 'Admin typecheck config check passed.'
};

const adminTypecheck: CommandSpec = {
  title: 'Admin typecheck',
  command: 'pnpm',
  args: ['--filter', '@community-selection/admin', 'exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
  successMessage: 'Admin typecheck passed.'
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { verify: false, publish: false, push: false, all: false, debug: false, skipSourceSyncCheck: true };
  for (const arg of argv) {
    if (arg === '--verify') parsed.verify = true;
    else if (arg === '--publish') parsed.publish = true;
    else if (arg === '--push') parsed.push = true;
    else if (arg === '--all') parsed.all = true;
    else if (arg === '--debug') parsed.debug = true;
    else if (arg === '--skip-source-sync-check') parsed.skipSourceSyncCheck = true;
    else if (arg === '--skip-source-sync-check=false') parsed.skipSourceSyncCheck = false;
    else if (arg.startsWith('--stage=')) parsed.stage = normalizeStage(arg.slice('--stage='.length));
    else if (arg.startsWith('--scope=')) parsed.scope = parseScope(arg.slice('--scope='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.all) parsed.verify = true;
  return parsed;
}

function parseScope(value: string): Scope {
  if (value === 'stage' || value === 'chain' || value === 'all') return value;
  throw new Error(`Unsupported scope: ${value}`);
}

function normalizeStage(value: string): string {
  return value.trim().toUpperCase();
}

function latestRegisteredStage(): string { return latestStageDefinition().id; }

function assertRegisteredStage(stage: string): void {
  const verifier = stageVerifiers[stage];
  const chain = regressionChains[stage];
  if (!verifier || !chain) {
    throw new Error(`Stage ${stage} is not registered on this branch.\nCurrent latest registered stage: ${latestRegisteredStage()}.`);
  }
  const verifierScript = verifier.args.at(-1);
  if (!verifierScript || !existsSync(join(process.cwd(), verifierScript))) {
    throw new Error(`Stage ${stage} verifier file is missing: ${verifierScript ?? 'unknown'}\nCurrent latest registered stage: ${latestRegisteredStage()}.`);
  }
}

function validateArgs(args: ParsedArgs): void {
  if (args.all && args.stage) throw new Error('Do not pass --all and --stage together; choose one to avoid ambiguity.');
  if (args.publish && !args.stage) throw new Error('--publish requires --stage=Lxx.');
  if (!args.verify && !args.publish) throw new Error('Nothing to do. Pass --verify, --publish, or --all.');
  if (args.stage) assertRegisteredStage(args.stage);
}


function appendOutput(content: string): void {
  if (!content) return;
  appendFileSync(latestVerifyOutput, content);
}

function printAndAppend(content: string): void {
  if (!content) return;
  process.stdout.write(content);
  appendOutput(content);
}

function runCommand(spec: CommandSpec): void {
  const header = `\n=== Running ${spec.title} ===\n`;
  printAndAppend(header);
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(spec.env ?? {}) },
    encoding: 'utf8'
  });
  printAndAppend(result.stdout ?? '');
  if (result.stderr) {
    process.stderr.write(result.stderr);
    appendOutput(result.stderr);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${spec.title} failed with exit code ${result.status ?? 'unknown'}`);
  printAndAppend(`command_completed:${spec.title}=true\n`);
  if (spec.successMessage) printAndAppend(`${spec.successMessage}\n`);
}

function resolveVerifyCommands(args: ParsedArgs, publishMode: boolean): CommandSpec[] {
  const scope: Scope = args.all ? 'all' : (args.scope ?? (publishMode ? 'chain' : 'stage'));
  if (scope === 'all') return [...Object.values(stageVerifiers), rawComplianceScan, dockerApiE2E, adminTypeConfigCheck, adminTypecheck];
  if (!args.stage) throw new Error(`--scope=${scope} requires --stage=Lxx unless --all is used.`);
  if (scope === 'stage') return [stageVerifiers[args.stage], ...stageAdditionalVerifiers[args.stage]];
  const chainCommands = regressionChains[args.stage].flatMap((stage) => stage === 'DOCKER_API_E2E' ? [dockerApiE2E] : stage === 'RAW_COMPLIANCE_SCAN' ? [rawComplianceScan] : stage === 'ADMIN_TYPECHECK' ? [adminTypeConfigCheck, adminTypecheck] : [stageVerifiers[stage]]);
  return chainCommands.flatMap((command) => command === stageVerifiers[args.stage] ? [command, ...stageAdditionalVerifiers[args.stage]] : [command]);
}

function prepareLatestOutput(): void {
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(latestVerifyOutput, '');
}

function resolvedScope(args: ParsedArgs, publishMode: boolean): Scope {
  return args.all ? 'all' : (args.scope ?? (publishMode ? 'chain' : 'stage'));
}

function chainRegressionLabel(stageId: string): string {
  const chain = getStageChain(stageId);
  const firstStage = chain.at(-1) ?? stageId;
  const lastStage = chain[0] ?? stageId;
  return `${firstStage}-${lastStage} chain regression`;
}

function runVerify(args: ParsedArgs, publishMode = false): void {
  prepareLatestOutput();
  const scope = resolvedScope(args, publishMode);
  for (const command of resolveVerifyCommands(args, publishMode)) runCommand(command);
  if (args.stage && scope === 'chain') {
    const label = chainRegressionLabel(args.stage);
    printAndAppend(`command_completed:${label}=true\n`);
    printAndAppend(`${label} passed.\n`);
  }
  printAndAppend('command_completed:Stage workflow=true\n');
  printAndAppend('\nStage workflow verification passed.\n');
}

function runReportStage(stage: string): void {
  runCommand({ title: `report:stage ${stage}`, command: 'pnpm', args: ['report:stage', '--', `--stage=${stage}`] });
}

function runReportVerifier(stage: string): void {
  runCommand({ title: 'report publish verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-report-publish-local.ts', `--stage=${stage}`] });
  const latestOutput = readFileSync(latestVerifyOutput, 'utf8');
  if (!latestOutput.includes('Report publish verification passed.')) {
    throw new Error('Report publish verifier did not emit required success marker: Report publish verification passed.');
  }
}

function runReportPublish(args: ParsedArgs): void {
  if (!args.stage) throw new Error('--publish requires --stage=Lxx.');
  const publishArgs = ['report:publish', '--', `--stage=${args.stage}`];
  if (args.skipSourceSyncCheck) publishArgs.push('--skip-source-sync-check');
  if (args.push) publishArgs.push('--push');
  runCommand({ title: `report:publish ${args.stage}`, command: 'pnpm', args: publishArgs });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  if (args.debug) {
    console.log(`Stage workflow args: ${JSON.stringify(args)}`);
  }
  if (args.publish) {
    runVerify(args, true);
    runReportStage(args.stage!);
    runReportVerifier(args.stage!);
    runReportPublish(args);
    return;
  }
  if (args.verify) runVerify(args, false);
}

main();
