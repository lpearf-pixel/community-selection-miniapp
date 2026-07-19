import { readFileSync } from 'node:fs';
import {
  L48_REPORT_EVIDENCE_LABELS,
  L48_SECURITY_EVIDENCE_LABELS,
  transformL48Report,
} from './l48-report-evidence-hook.ts';
import {
  L48_BUSINESS_BASE_BRANCH,
  L48_BUSINESS_BASE_COMMIT,
  L48_MINIMUM_CURRENT_USER_ROUTES,
  L48_RUNTIME_MARKERS,
} from './l48-security-privacy-contract.ts';

const TEST_COMMIT = '1234567890abcdef1234567890abcdef12345678';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function occurrenceCount(content: string, token: string): number {
  return content.split(token).length - 1;
}

function reportFixture(dbHeader: '## 4. 数据库变化' | '## 4. DB 变化'): string {
  return `# 阶段验收报告：L48

## 1. 阶段结论

- 阶段：L48
- 业务稳定分支：${L48_BUSINESS_BASE_BRANCH}
- 业务稳定 commit：${L48_BUSINESS_BASE_COMMIT}
- 报告生成分支：work/l48-security-privacy-hardening
- 报告生成 commit：${TEST_COMMIT}
- 分支：work/l48-security-privacy-hardening（报告生成环境）
- 生成时间：2026-07-19T00:00:00.000Z
- 当前 commit：${TEST_COMMIT}（报告生成环境）
- 注册阶段标题：Security and Privacy Hardening
- 本阶段目标：Security and Privacy Hardening
- Codex 自评结论：partial

## 2. 本阶段变更范围

| 类型 | 文件 | 说明 |
|---|---|---|
| API | apps/api/src/app.ts | fixture |

## 3. API 变化

fixture

${dbHeader}

fixture

## 5. 核心业务验收点

- [ ] fixture

## 6. 验收脚本

| 脚本 | 是否存在 | 是否已加入 verify-all | 说明 |
|---|---|---|---|
| fixture | yes | yes | fixture |

## 7. 阶段验证执行结果

fixture

## 8. 合规边界检查

fixture

## 9. 风险点

- 高风险：暂无自动发现，需人工 review
- 中风险：暂无自动发现，需人工 review
- 低风险：fixture

## 10. 未完成项

暂无自动发现，需人工 review

## 11. Codex 给人工 reviewer 的说明

fixture
`;
}

function completeVerifyOutput(commit = TEST_COMMIT): string {
  return [
    `verification_source_commit:${commit}`,
    'command_completed:L48 verifier=true',
    'command_completed:L48 security privacy Docker E2E=true',
    'command_completed:L48 report routing verifier=true',
    'command_completed:L24-L48 chain regression=true',
    'L24-L48 chain regression passed.',
    'command_completed:Docker API E2E=true',
    'command_completed:Admin typecheck config check=true',
    'command_completed:Admin typecheck=true',
    'command_completed:raw compliance scan=true',
    'command_completed:Stage workflow=true',
    ...L48_RUNTIME_MARKERS,
  ].join('\n');
}

for (const dbHeader of ['## 4. 数据库变化', '## 4. DB 变化'] as const) {
  const transformed = transformL48Report(
    reportFixture(dbHeader),
    completeVerifyOutput(),
    TEST_COMMIT,
  );

  assert(
    transformed.startsWith('# 阶段验收报告：L48'),
    `L48 transformed report must not gain a leading blank line for ${dbHeader}`,
  );
  assert(
    transformed.includes('- Codex 自评结论：passed'),
    `L48 complete evidence must produce passed for ${dbHeader}`,
  );
  assert(
    transformed.includes('## 4. DB 变化') &&
      transformed.includes('- 无新增 migration') &&
      transformed.includes('- 未修改 prisma/schema.prisma'),
    `L48 DB section mismatch for ${dbHeader}`,
  );
  assert(
    occurrenceCount(transformed, '## 11. Codex 给人工 reviewer 的说明') === 1,
    `L48 reviewer section must occur exactly once for ${dbHeader}`,
  );
  assert(
    transformed.includes(
      '可信 header 是当前项目边界，不等同于 JWT/OAuth 或微信 session 认证。',
    ),
    `L48 trusted-header limitation missing for ${dbHeader}`,
  );
  assert(
    transformed.includes(
      '本阶段未实现加密、限流、CORS 重构、数据删除机制、自动打款或自动报税。',
    ),
    `L48 out-of-scope limitation missing for ${dbHeader}`,
  );
  assert(
    transformed.includes('暂无自动发现') &&
      !transformed.includes('机器证据未全部通过'),
    `L48 passed risk/unfinished sections mismatch for ${dbHeader}`,
  );

  for (const route of L48_MINIMUM_CURRENT_USER_ROUTES) {
    assert(
      transformed.includes(`| ${route.method} | ${route.path} |`),
      `L48 report missing route ${route.method} ${route.path}`,
    );
  }
  for (const label of [
    ...L48_REPORT_EVIDENCE_LABELS,
    ...L48_SECURITY_EVIDENCE_LABELS,
  ]) {
    assert(
      transformed.includes(label),
      `L48 report missing evidence label: ${label}`,
    );
  }
}

const mismatched = transformL48Report(
  reportFixture('## 4. 数据库变化'),
  completeVerifyOutput('abcdefabcdefabcdefabcdefabcdefabcdefabcd'),
  TEST_COMMIT,
);
assert(
  mismatched.includes('- Codex 自评结论：partial'),
  'L48 report must remain partial when verification source commit does not match HEAD',
);
assert(
  mismatched.includes('机器证据未全部通过'),
  'L48 source mismatch must remain visible in risks or unfinished items',
);

const duplicateMarkerOutput = `${completeVerifyOutput()}\n${L48_RUNTIME_MARKERS[0]}`;
const duplicateMarkerReport = transformL48Report(
  reportFixture('## 4. 数据库变化'),
  duplicateMarkerOutput,
  TEST_COMMIT,
);
assert(
  duplicateMarkerReport.includes('- Codex 自评结论：partial'),
  'L48 duplicate runtime marker must prevent a passed report',
);

const generator = readFileSync('scripts/generate-stage-report-entry.ts', 'utf8');
assert(
  generator.includes("import { applyL48ReportEvidence } from './l48-report-evidence-hook.ts'") &&
    generator.includes("if (stage === 'L48') applyL48ReportEvidence()"),
  'L48 report hook must be registered in generate-stage-report-entry.ts',
);

const workflow = readFileSync('scripts/stage-workflow.ts', 'utf8');
assert(
  workflow.includes('L48 security privacy Docker E2E') &&
    workflow.includes('L48 report routing verifier') &&
    workflow.includes("stage === 'L48'") &&
    workflow.includes('verify-l48-report-publish-local.ts'),
  'L48 report generation/verifier routing must be registered in stage-workflow.ts',
);

const publisher = readFileSync('scripts/publish-stage-report.ts', 'utf8');
assert(
  publisher.includes('verify-l48-report-publish-local.ts'),
  'L48 strict publish verifier must be registered in publish-stage-report.ts',
);

console.log('L48 report routing verification passed.');
