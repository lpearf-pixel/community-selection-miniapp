import { readFileSync } from 'node:fs';

export const COMPLIANCE_FORBIDDEN_TERMS = [
  `parent_${'leader'}_id`,
  `up${'line'}_id`,
  `down${'line'}`,
  `team_${'id'}`,
  `le${'vel'} ${'commission'}`,
  `多级${'分'}销`,
  `团队${'收益'}`,
  `代理${'收益'}`,
  `优${'惠'}券`,
  `裂${'变'}`,
  `AUTO_PAYOUT_ENABLED = ${'true'}`,
  `AUTO_TAX_FILING_ENABLED = ${'true'}`
] as const;

export function scanComplianceFiles(files: string[]): void {
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const term of COMPLIANCE_FORBIDDEN_TERMS) {
    if (source.includes(term)) throw new Error(`forbidden compliance term found: ${term}`);
  }
}
