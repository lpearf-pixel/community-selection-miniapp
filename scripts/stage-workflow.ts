import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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

const stageVerifiers: Record<string, CommandSpec> = {
  L24: { title: 'L24 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l24-miniapp-cart-local.ts'] },
  L25: { title: 'L25 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l25-order-confirm-quantity-guard-local.ts'] },
  L26: { title: 'L26 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l26-group-buy-success-rule-local.ts'] },
  L27: { title: 'L27 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts'] },
  L28: { title: 'L28 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l28-refund-ledger-finance-check-local.ts'] },
  L29: { title: 'L29 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l29-admin-refund-ledger-page-local.ts'] },
  L30: { title: 'L30 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l30-refund-payment-risk-idempotency-local.ts'] },
  L31: { title: 'L31 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l31-admin-access-control-baseline-local.ts'] },
  L32: { title: 'L32 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l32-clerk-pickup-workbench-local.ts'] },
  L33: { title: 'L33 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts'] },
  L34: { title: 'L34 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l34-admin-data-scope-baseline-local.ts'] },
  L35: { title: 'L35 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l35-user-delivery-option-baseline-local.ts'] },
  L36: { title: 'L36 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts'] },
  L37: { title: 'L37 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l37-delivery-rule-config-baseline-local.ts'] },
  L38: { title: 'L38 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts'] },
  L39: { title: 'L39 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l39-delivery-refund-finance-baseline-local.ts'] },
  L40: { title: 'L40 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l40-admin-order-after-sale-workbench-local.ts'] },
  L41: { title: 'L41 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l41-inventory-deduct-restore-local.ts'] },
  L42: { title: 'L42 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l42-failed-group-buy-manual-closure-local.ts'] },
  L43: { title: 'L43 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts'] },
  L44: { title: 'L44 verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-l44-manual-withdrawal-review-local.ts'] }
};

const regressionChains: Record<string, string[]> = {
  L24: ['L24'],
  L25: ['L25', 'L24'],
  L26: ['L26', 'L25', 'L24'],
  L27: ['L27', 'L26', 'L25', 'L24'],
  L28: ['L28', 'L27', 'L26', 'L25', 'L24'],
  L29: ['L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L30: ['L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L31: ['L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L32: ['L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L33: ['L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L34: ['L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L35: ['L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L36: ['L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L37: ['L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'],
  L38: ['L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L39: ['L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L40: ['L40', 'L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L41: ['L41', 'L40', 'L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L42: ['L42', 'L41', 'L40', 'L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L43: ['L43', 'L42', 'L41', 'L40', 'L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'RAW_COMPLIANCE_SCAN', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK'],
  L44: ['L44', 'L43', 'L42', 'L41', 'L40', 'L39', 'L38', 'L37', 'L36', 'L35', 'L34', 'L33', 'L32', 'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'RAW_COMPLIANCE_SCAN', 'DOCKER_API_E2E', 'ADMIN_TYPECHECK']
};

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

function latestRegisteredStage(): string {
  return Object.keys(stageVerifiers)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .at(-1)!;
}

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
  if (spec.successMessage) printAndAppend(`${spec.successMessage}\n`);
}

function resolveVerifyCommands(args: ParsedArgs, publishMode: boolean): CommandSpec[] {
  const scope: Scope = args.all ? 'all' : (args.scope ?? (publishMode ? 'chain' : 'stage'));
  if (scope === 'all') return [...Object.values(stageVerifiers), rawComplianceScan, dockerApiE2E, adminTypeConfigCheck, adminTypecheck];
  if (!args.stage) throw new Error(`--scope=${scope} requires --stage=Lxx unless --all is used.`);
  if (scope === 'stage') return [stageVerifiers[args.stage]];
  const chainCommands = regressionChains[args.stage].flatMap((stage) => stage === 'DOCKER_API_E2E' ? [dockerApiE2E] : stage === 'RAW_COMPLIANCE_SCAN' ? [rawComplianceScan] : stage === 'ADMIN_TYPECHECK' ? [adminTypeConfigCheck, adminTypecheck] : [stageVerifiers[stage]]);
  return chainCommands;
}

function prepareLatestOutput(): void {
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(latestVerifyOutput, '');
}

function runVerify(args: ParsedArgs, publishMode = false): void {
  prepareLatestOutput();
  for (const command of resolveVerifyCommands(args, publishMode)) runCommand(command);
  printAndAppend('\nStage workflow verification passed.\n');
}

function runReportStage(stage: string): void {
  runCommand({ title: `report:stage ${stage}`, command: 'pnpm', args: ['report:stage', '--', `--stage=${stage}`] });
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
    runReportPublish(args);
    return;
  }
  if (args.verify) runVerify(args, false);
}

main();
