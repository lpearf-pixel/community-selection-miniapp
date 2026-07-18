import './generate-stage-report.ts';
import { parseStageArg } from './stage-args.ts';
import { applyL46ReportEvidence } from './l46-report-evidence-hook.ts';
import { applyL47ReportEvidence } from './l47-report-evidence-hook.ts';
import { applyStageReportArtifactNormalization } from './report-artifact-normalizer.ts';

const stage = parseStageArg(process.argv.slice(2));
if (stage === 'L46') applyL46ReportEvidence();
if (stage === 'L47') applyL47ReportEvidence();
applyStageReportArtifactNormalization(stage);
