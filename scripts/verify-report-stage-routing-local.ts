import { readFileSync } from 'node:fs';
import { getStageDefinition } from './stage-registry.ts';
import { parseStageArg } from './stage-args.ts';
function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
assert(parseStageArg(['--stage=L45']) === 'L45', 'inline stage'); assert(parseStageArg(['--stage', 'L46']) === 'L46', 'split stage');
const generator = readFileSync('scripts/generate-stage-report.ts', 'utf8'); const verifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');
const l46 = getStageDefinition('L46'); assert(l46?.title === 'Admin Business Dashboard V2', 'L46 registry title');
assert(generator.includes("title: 'L45 manual tax review and internal CSV export'"), 'L45 retains manifest title');
assert(generator.includes('stageManifest?.title ?? stageDefinition.title'), 'generator selects manifest then registry title');
assert(!generator.includes('${stage} 阶段目标，需结合阶段说明人工确认'), 'no generic L46 fallback');
assert(generator.includes('reportContract') && verifier.includes('definition.reportContract'), 'shared report contract');
assert(!verifier.includes('reportChangedFileBases') && !verifier.includes("?? 'HEAD~1'"), 'L46 does not fall back to HEAD~1');
assert(!verifier.includes("report.includes('Admin Business Dashboard V2')"), 'verifier has no hardcoded L46 title');
console.log('Report stage routing checks passed.');
