const fs = require('node:fs');

const target = 'scripts/verify-report-publish-local.ts';
let source = fs.readFileSync(target, 'utf8');

const before = `const stageWorkflowSource = read('scripts/stage-workflow.ts');
const reportStageIndex = stageWorkflowSource.indexOf('runReportStage(args.stage!)');
const reportVerifierIndex = stageWorkflowSource.indexOf('runReportVerifier()');
const reportPublishIndex = stageWorkflowSource.indexOf('runReportPublish(args)');
assert(reportStageIndex >= 0, 'stage workflow must run report:stage in publish flow');
assert(reportVerifierIndex > reportStageIndex, 'stage workflow must run report verifier after report:stage');
assert(reportPublishIndex > reportVerifierIndex, 'stage workflow must run report verifier before report publish');`;

const after = `const stageWorkflowSource = read('scripts/stage-workflow.ts');
const mainStart = stageWorkflowSource.indexOf('function main(): void {');
assert(mainStart >= 0, 'stage workflow main function must exist');
const mainSource = stageWorkflowSource.slice(mainStart);
const reportStageIndex = mainSource.indexOf('runReportStage(args.stage!)');
const reportVerifierIndex = mainSource.indexOf('runReportVerifier();');
const reportPublishIndex = mainSource.indexOf('runReportPublish(args)');
assert(reportStageIndex >= 0, 'stage workflow must run report:stage in publish flow');
assert(reportVerifierIndex > reportStageIndex, 'stage workflow must run report verifier after report:stage');
assert(reportPublishIndex > reportVerifierIndex, 'stage workflow must run report verifier before report publish');`;

if (!source.includes(before)) {
  throw new Error('Expected report-order verifier block was not found. Refusing to make an unsafe edit.');
}

source = source.replace(before, after);
fs.writeFileSync(target, source);
