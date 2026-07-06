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
  `会${'员'}`,
  `裂${'变'}`,
  `AUTO_PAYOUT_ENABLED = ${'true'}`,
  `AUTO_TAX_FILING_ENABLED = ${'true'}`
] as const;

function isAllowedNegatedComplianceContext(source: string, index: number) {
  const context = source.slice(Math.max(0, index - 16), Math.min(source.length, index + 32));
  return /(?:无|不包含|不新增|不要开启|不要设置|不启用|不接|当前 MVP 不包含|没有新增)/.test(context);
}

export function scanComplianceFiles(files: string[]): void {
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const term of COMPLIANCE_FORBIDDEN_TERMS) {
    let index = source.indexOf(term);
    while (index >= 0) {
      if (!isAllowedNegatedComplianceContext(source, index)) throw new Error(`forbidden compliance term found: ${term}`);
      index = source.indexOf(term, index + term.length);
    }
  }
}
