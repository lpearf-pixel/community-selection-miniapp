import './generate-stage-report.ts';
import { parseStageArg } from './stage-args.ts';
import { applyL46ReportEvidence } from './l46-report-evidence-hook.ts';

const stage = parseStageArg(process.argv.slice(2));
if (stage === 'L46') applyL46ReportEvidence();
