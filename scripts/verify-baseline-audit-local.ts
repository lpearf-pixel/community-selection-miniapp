import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { VERIFICATION_BASELINE_CHECKS } from './verification-baseline-manifest.ts';

const require = createRequire(import.meta.url);
const {
  auditExitCode,
  runVerificationAudit,
} = require('./lib/verification-audit.cjs') as {
  auditExitCode: (
    report: { failed: number },
    options: { reportOnly: boolean },
  ) => number;
  runVerificationAudit: (options: Record<string, unknown>) => {
    total: number;
    passed: number;
    failed: number;
  };
};

const valueArg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const reportOnly = process.argv.includes('--report-only');
const outputDir = resolve(
  valueArg('output-dir') ?? 'artifacts/verification-baseline',
);

const API_PORT = process.env.API_PORT ?? process.env.PORT ?? '13080';
const env = {
  ...process.env,
  API_PORT,
  API_HOST: process.env.API_HOST ?? '127.0.0.1',
  API_BASE_URL:
    process.env.API_BASE_URL ?? `http://127.0.0.1:${API_PORT}`,
  NO_PROXY: process.env.NO_PROXY ?? 'localhost,127.0.0.1,::1',
  no_proxy: process.env.no_proxy ?? 'localhost,127.0.0.1,::1',
  PORT: API_PORT,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:15432/community_selection?schema=public',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? 'dev-admin-token',
  ADMIN_AUTH_ENABLED: process.env.ADMIN_AUTH_ENABLED ?? 'false',
  ADMIN_AUTH_MODE: process.env.ADMIN_AUTH_MODE ?? 'token',
  WECHAT_PAY_MODE: process.env.WECHAT_PAY_MODE ?? 'mock',
  MOCK_WECHAT_PAY: process.env.MOCK_WECHAT_PAY ?? 'true',
  AUTO_PAYOUT_ENABLED: process.env.AUTO_PAYOUT_ENABLED ?? 'false',
  AUTO_TAX_FILING_ENABLED:
    process.env.AUTO_TAX_FILING_ENABLED ?? 'false',
};

const report = runVerificationAudit({
  checks: VERIFICATION_BASELINE_CHECKS,
  cwd: process.cwd(),
  env,
  outputDir,
  onProgress(event: {
    event: 'started' | 'completed';
    check: { id: string };
    observation?: { status: string; exit_code: number };
    index: number;
    total: number;
  }) {
    if (event.event === 'started') {
      console.log(
        `audit_check_started:${event.index + 1}/${event.total}:${event.check.id}`,
      );
      return;
    }
    console.log(
      `audit_check_completed:${event.check.id}=${event.observation?.status}:exit_${event.observation?.exit_code}`,
    );
  },
});

console.log(
  `verification_baseline_audit:total=${report.total}:passed=${report.passed}:failed=${report.failed}`,
);
process.exitCode = auditExitCode(report, { reportOnly });
