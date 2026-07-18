import { readFileSync } from 'node:fs';
import { getStageDefinition } from './stage-registry.ts';
import { resolveReportSource } from './stage-report-source.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const definition = getStageDefinition('L47');
assert(definition, 'L47 must be registered');
assert(definition.reportContract, 'L47 report contract must be registered');
const source = resolveReportSource('L47');
assert(source.sourceMode === 'git_diff', 'L47 report source must use git_diff');
assert(source.businessBaseBranch === 'stable/l46-business-base', 'L47 report base branch mismatch');
assert(source.businessBaseCommit === 'fe7b8c185816912d5e198dc960f8b979b532525f', 'L47 report base commit mismatch');

const entry = read('scripts/generate-stage-report-entry.ts');
assert(entry.includes("import { applyL47ReportEvidence } from './l47-report-evidence-hook.ts'"), 'Canonical report entry must import L47 evidence hook');
assert(/if\s*\(\s*stage\s*===\s*['"]L47['"]\s*\)\s*applyL47ReportEvidence\s*\(\s*\)/.test(entry), 'Canonical report entry must apply L47 evidence only for L47');
assert(/if\s*\(\s*stage\s*===\s*['"]L46['"]\s*\)\s*applyL46ReportEvidence\s*\(\s*\)/.test(entry), 'Canonical report entry must preserve L46 evidence routing');

const workflow = read('scripts/stage-workflow.ts').replace(/\s+/g, ' ');
const reportStage = workflow.slice(workflow.indexOf('function runReportStage'), workflow.indexOf('function runReportVerifier'));
const reportVerifier = workflow.slice(workflow.indexOf('function runReportVerifier'), workflow.indexOf('function runReportPublish'));
assert(/stage\s*===\s*['"]L47['"]/.test(reportStage) && reportStage.includes('scripts/generate-stage-report-entry.ts'), 'Stage workflow must route L47 report generation through canonical entry');
assert(/stage\s*===\s*['"]L47['"]/.test(reportVerifier) && reportVerifier.includes('scripts/verify-l47-report-publish-local.ts'), 'Stage workflow must route L47 through strict report gate');
assert(/stage\s*===\s*['"]L46['"]/.test(reportStage) && reportStage.includes('scripts/generate-stage-report-entry.ts'), 'Stage workflow must preserve L46 report generation route');
assert(/stage\s*===\s*['"]L46['"]/.test(reportVerifier) && reportVerifier.includes('scripts/verify-l46-report-publish-local.ts'), 'Stage workflow must preserve L46 strict report gate');
assert(reportVerifier.includes('scripts/verify-report-publish-local.ts'), 'Stage workflow must preserve historical report verifier');

const publisher = read('scripts/publish-stage-report.ts').replace(/\s+/g, ' ');
const publisherReport = publisher.slice(publisher.indexOf('function runStageReport'), publisher.indexOf('function verifyStageReportBeforeCopy'));
const publisherVerifier = publisher.slice(publisher.indexOf('function verifyStageReportBeforeCopy'), publisher.indexOf('function main'));
assert(/stage\s*===\s*['"]L47['"]/.test(publisherReport) && publisherReport.includes('scripts/generate-stage-report-entry.ts'), 'Publisher must regenerate L47 through canonical entry');
assert(/stage\s*===\s*['"]L47['"]/.test(publisherVerifier) && publisherVerifier.includes('scripts/verify-l47-report-publish-local.ts'), 'Publisher must run L47 strict gate before copy');
assert(/stage\s*===\s*['"]L46['"]/.test(publisherReport), 'Publisher must preserve L46 canonical generation');
assert(publisherVerifier.includes('scripts/verify-l46-report-publish-local.ts'), 'Publisher must preserve L46 strict gate');

const historicalGenerator = read('scripts/generate-stage-report.ts');
const historicalVerifier = read('scripts/verify-report-publish-local.ts');
assert(!historicalGenerator.includes('applyL47ReportEvidence'), 'Historical generator must remain free of L47 side effects');
assert(!historicalVerifier.includes('verify-l47-report-publish-local'), 'Historical publish verifier must remain independent of L47 strict gate');

console.log('L47 report routing verification passed.');
