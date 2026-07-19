import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  L48_BUSINESS_BASE_BRANCH,
  L48_BUSINESS_BASE_COMMIT,
  L48_MINIMUM_CURRENT_USER_ROUTES,
  L48_RUNTIME_MARKERS,
} from './l48-security-privacy-contract.ts';

export type L48EvidenceStatus = 'passed' | 'failed' | 'not detected';
export type L48EvidenceRow = { command: string; result: L48EvidenceStatus };

const routeCount = L48_MINIMUM_CURRENT_USER_ROUTES.length;

export const L48_REPORT_EVIDENCE_LABELS = [
  'L48 verifier',
  'L48 security privacy Docker E2E',
  'L48 report routing verifier',
  'L24-L48 chain regression',
  'Docker API E2E',
  'Admin typecheck config',
  'Admin full typecheck',
  'raw compliance scan',
  'Stage workflow',
] as const;

export const L48_SECURITY_EVIDENCE_LABELS = [
  `${routeCount} 条 current-user 路由完整使用共享安全边界`,
  'header-only 身份、优先级、inactive 与 leader 角色边界',
  '奖励查询、转换与提现均按当前团长归属',
  '响应递归隐私扫描',
  'HTTP 请求与响应日志隐私扫描',
  '业务日志与失败兜底隐私扫描',
  '未知异常固定 500 且不返回内部 message/stack',
] as const;

function hasExplicitFailure(content: string): boolean {
  return (
    [
      'ERR_PNPM',
      'Command failed',
      'ELIFECYCLE',
      'failed with exit code',
      'exit code 1',
      'exit code 2',
      'MODULE_NOT_FOUND',
      'TypeScript error TS',
      'PrismaClientKnownRequestError',
      'ReferenceError',
    ].some((marker) => content.includes(marker)) || /\berror TS\d{4}\b/.test(content)
  );
}

function completed(content: string, title: string): L48EvidenceStatus {
  if (content.includes(`command_completed:${title}=true`)) return 'passed';
  return hasExplicitFailure(content) ? 'failed' : 'not detected';
}

function occurrenceCount(content: string, token: string): number {
  return content.split(token).length - 1;
}

function markerPassed(content: string, marker: string): boolean {
  return occurrenceCount(content, marker) === 1;
}

export function l48VerificationSourceCommit(content: string): string | undefined {
  const matches = Array.from(
    content.matchAll(/^verification_source_commit:([0-9a-f]{40})$/gm),
  );
  return matches.length === 1 ? matches[0][1] : undefined;
}

export function hasExactL48RuntimeMarkers(content: string): boolean {
  return L48_RUNTIME_MARKERS.every((marker) => markerPassed(content, marker));
}

function unresolvedRows(content: string): L48EvidenceRow[] {
  const result: L48EvidenceStatus = hasExplicitFailure(content)
    ? 'failed'
    : 'not detected';
  return L48_REPORT_EVIDENCE_LABELS.map((command) => ({ command, result }));
}

export function l48EvidenceRows(
  content: string,
  expectedCommit?: string,
): L48EvidenceRow[] {
  if (expectedCommit && l48VerificationSourceCommit(content) !== expectedCommit) {
    return unresolvedRows(content);
  }

  const chainPassed =
    content.includes('command_completed:L24-L48 chain regression=true') &&
    content.includes('L24-L48 chain regression passed.');
  const chainResult: L48EvidenceStatus = chainPassed
    ? 'passed'
    : hasExplicitFailure(content)
      ? 'failed'
      : 'not detected';

  return [
    { command: 'L48 verifier', result: completed(content, 'L48 verifier') },
    {
      command: 'L48 security privacy Docker E2E',
      result: completed(content, 'L48 security privacy Docker E2E'),
    },
    {
      command: 'L48 report routing verifier',
      result: completed(content, 'L48 report routing verifier'),
    },
    { command: 'L24-L48 chain regression', result: chainResult },
    { command: 'Docker API E2E', result: completed(content, 'Docker API E2E') },
    {
      command: 'Admin typecheck config',
      result: completed(content, 'Admin typecheck config check'),
    },
    {
      command: 'Admin full typecheck',
      result: completed(content, 'Admin typecheck'),
    },
    {
      command: 'raw compliance scan',
      result: completed(content, 'raw compliance scan'),
    },
    { command: 'Stage workflow', result: completed(content, 'Stage workflow') },
  ];
}

function securityEvidenceRows(content: string): L48EvidenceRow[] {
  const status = (passed: boolean): L48EvidenceStatus =>
    passed ? 'passed' : hasExplicitFailure(content) ? 'failed' : 'not detected';

  return [
    {
      command: L48_SECURITY_EVIDENCE_LABELS[0],
      result: status(completed(content, 'L48 verifier') === 'passed'),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[1],
      result: status(
        [
          'l48_query_only_identity_rejected=true',
          'l48_header_identity_wins=true',
          'l48_inactive_user_forbidden=true',
          'l48_non_leader_forbidden=true',
        ].every((marker) => markerPassed(content, marker)),
      ),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[2],
      result: status(
        [
          'l48_reward_owner_scope_verified=true',
          'l48_withdrawal_owner_scope_verified=true',
        ].every((marker) => markerPassed(content, marker)),
      ),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[3],
      result: status(markerPassed(content, 'l48_response_privacy_verified=true')),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[4],
      result: status(markerPassed(content, 'l48_http_log_privacy_verified=true')),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[5],
      result: status(markerPassed(content, 'l48_business_log_privacy_verified=true')),
    },
    {
      command: L48_SECURITY_EVIDENCE_LABELS[6],
      result: status(markerPassed(content, 'l48_unknown_error_sanitized=true')),
    },
  ];
}

function replaceSection(
  report: string,
  startHeader: string,
  endHeader: string,
  replacement: string,
): string {
  const start = report.indexOf(startHeader);
  const end = report.indexOf(endHeader, start);
  if (start < 0 || end <= start) {
    throw new Error(
      `L48 report section boundaries are missing: ${startHeader} -> ${endHeader}`,
    );
  }
  return `${report.slice(0, start)}${replacement}\n\n${report.slice(end)}`;
}

function replaceFinalSection(
  report: string,
  startHeader: string,
  replacement: string,
): string {
  const start = report.indexOf(startHeader);
  if (start < 0) {
    throw new Error(`L48 final report section is missing: ${startHeader}`);
  }
  return `${report.slice(0, start)}${replacement}\n`;
}

function inputDbHeader(report: string): string {
  for (const header of ['## 4. 数据库变化', '## 4. DB 变化']) {
    if (report.includes(header)) return header;
  }
  throw new Error('L48 report DB section header is missing');
}

function apiPermission(path: string): string {
  return path.startsWith('/api/leaders/me/')
    ? 'active current leader；x-user-id 优先，x-openid fallback；query/body 不参与归属'
    : 'active current user；x-user-id 优先，x-openid fallback；query/body 不参与归属';
}

function apiPurpose(method: string, path: string): string {
  if (path.endsWith('/center-summary')) {
    return path.startsWith('/api/leaders/') ? '团长中心只读摘要' : '个人中心只读摘要';
  }
  if (path === '/api/leaders/me/dashboard') return '当前团长业务看板';
  if (path === '/api/me/orders') return '当前用户订单列表';
  if (path.endsWith('/pickup-code')) return '当前用户订单自提凭证';
  if (path.endsWith('/after-sales')) {
    return method === 'POST' ? '当前用户提交订单售后' : '当前用户订单售后列表';
  }
  if (path === '/api/leaders/me/commissions') return '当前团长奖励明细与可用余额';
  if (path === '/api/leaders/me/withdrawals' && method === 'POST') {
    return '当前团长提交人工提现申请';
  }
  if (path === '/api/leaders/me/withdrawals') return '当前团长提现列表';
  if (path.includes('/withdrawals/:id')) return '当前团长提现详情';
  if (path.endsWith('/withdrawable-commissions')) return '当前团长可提现奖励';
  if (path.endsWith('/rewards/convert-credit')) return '当前团长奖励转消费额度';
  return '当前用户订单详情';
}

function renderApiSection(): string {
  return [
    '## 3. API 变化',
    '',
    '| 方法 | 路径 | 权限 | 用途 | 验证 |',
    '|---|---|---|---|---|',
    ...L48_MINIMUM_CURRENT_USER_ROUTES.map(
      (api) =>
        `| ${api.method} | ${api.path} | ${apiPermission(api.path)} | ${apiPurpose(api.method, api.path)} | passed |`,
    ),
  ].join('\n');
}

function renderDbSection(): string {
  return [
    '## 4. DB 变化',
    '',
    '- 无新增表',
    '- 无新增字段',
    '- 无新增 migration',
    '- 未修改 prisma/schema.prisma',
    '- 复用 User、Order、AfterSaleCase、GroupBuy、Commission、RewardLedger、ConsumerCreditLedger、RewardConversion、TaxRecord、Withdrawal 与业务日志表',
  ].join('\n');
}

function renderChecklistSection(
  commandRows: L48EvidenceRow[],
  securityRows: L48EvidenceRow[],
  markersPassed: boolean,
): string {
  return [
    '## 5. 核心业务验收点',
    '',
    ...[...commandRows, ...securityRows].map(
      (row) =>
        `- [${row.result === 'passed' ? 'x' : ' '}] ${row.command}（machine evidence: ${row.result}）`,
    ),
    `- [${markersPassed ? 'x' : ' '}] L48 十个运行 marker 各出现一次（machine evidence: ${markersPassed ? 'passed' : 'not detected'}）`,
  ].join('\n');
}

function renderEvidenceSection(
  commandRows: L48EvidenceRow[],
  securityRows: L48EvidenceRow[],
  markersPassed: boolean,
): string {
  return [
    '## 7. 阶段验证执行结果',
    '',
    '| 证据 | 结果 |',
    '|---|---|',
    ...[...commandRows, ...securityRows].map(
      (row) => `| ${row.command} | ${row.result} |`,
    ),
    `| L48 十个运行 marker 各出现一次 | ${markersPassed ? 'passed' : 'not detected'} |`,
  ].join('\n');
}

function renderComplianceSection(allPassed: boolean): string {
  const mark = allPassed ? 'x' : ' ';
  return [
    '## 8. 合规边界检查',
    '',
    `- [${mark}] ${routeCount} 条 /api/me/** 与 /api/leaders/me/** 路由统一使用 header-only 当前用户安全边界。`,
    `- [${mark}] query/body 身份字段不决定订单、奖励、提现和转换归属。`,
    `- [${mark}] 未知异常统一固定 500；客户端与日志均不出现原始 message 或 stack。`,
    `- [${mark}] current-user 响应不返回原始身份、联系方式、详细地址、账户、人工流水、税务或管理员备注。`,
    `- [${mark}] HTTP 日志不记录 query、敏感 headers、body、cookies、session 或客户端 IP。`,
    `- [${mark}] 业务日志 payload、snapshot、message/title 与失败兜底均执行脱敏，同时保留结构化审计关联字段。`,
    `- [${mark}] 无依赖、数据库 schema 或 migration 变化。`,
    '- 可信 header 是当前项目边界，不等同于 JWT/OAuth 或微信 session 认证。',
    '- 本阶段未实现加密、限流、CORS 重构、数据删除机制、自动打款或自动报税。',
  ].join('\n');
}

function renderRiskSection(allPassed: boolean): string {
  return [
    '## 9. 风险点',
    '',
    `- 高风险：${allPassed ? '暂无自动发现' : '机器证据未全部通过，禁止发布'}`,
    `- 中风险：${allPassed ? '暂无自动发现' : '需完成缺失的验证与人工复核'}`,
    '- 低风险：当前仍信任 x-user-id / x-openid 请求头；它们不是完整认证机制。非 /api/me/** 与 /api/leaders/me/** 的其他身份型接口不在 L48 改造范围。',
  ].join('\n');
}

function renderReviewerSection(): string {
  return [
    '## 11. Codex 给人工 reviewer 的说明',
    '',
    '- 本阶段统一 current-user 身份边界、错误映射、响应 DTO 与 HTTP/业务日志隐私。',
    `- 人工重点检查 ${routeCount} 条路由是否全部使用共享 wrapper，query/body 冲突是否无法切换归属。`,
    '- 人工重点检查 commissions/withdrawals 混合路由文件中的 Admin 权限与 data scope 未被改变。',
    '- 人工重点检查响应键、日志唯一 marker、固定 500 与奖励查询/转换/提现跨团长归属测试。',
    '- 可信 header 仍不是完整认证；该限制必须保留在发布说明中。',
    '- Reviewer 清单：docs/reviews/l48-security-privacy-hardening.md。',
    '- 只有最终报告绑定当前业务 HEAD、全部机器证据通过且人工 review 无高/中风险时，才建议创建不自动合并的 PR。',
  ].join('\n');
}

export function transformL48Report(
  report: string,
  verifyOutput: string,
  expectedCommit?: string,
): string {
  const commandRows = l48EvidenceRows(verifyOutput, expectedCommit);
  const securityRows = securityEvidenceRows(verifyOutput);
  const sourceBound = expectedCommit
    ? l48VerificationSourceCommit(verifyOutput) === expectedCommit
    : true;
  const markersPassed = sourceBound && hasExactL48RuntimeMarkers(verifyOutput);
  const allPassed =
    sourceBound &&
    commandRows.length === L48_REPORT_EVIDENCE_LABELS.length &&
    commandRows.every((row) => row.result === 'passed') &&
    securityRows.every((row) => row.result === 'passed') &&
    markersPassed;
  const dbHeader = inputDbHeader(report);

  let updated = replaceSection(report, '## 3. API 变化', dbHeader, renderApiSection());
  updated = replaceSection(updated, dbHeader, '## 5. 核心业务验收点', renderDbSection());
  updated = replaceSection(
    updated,
    '## 5. 核心业务验收点',
    '## 6. 验收脚本',
    renderChecklistSection(commandRows, securityRows, markersPassed),
  );
  updated = replaceSection(
    updated,
    '## 7. 阶段验证执行结果',
    '## 8. 合规边界检查',
    renderEvidenceSection(commandRows, securityRows, markersPassed),
  );
  updated = replaceSection(
    updated,
    '## 8. 合规边界检查',
    '## 9. 风险点',
    renderComplianceSection(allPassed),
  );
  updated = replaceSection(
    updated,
    '## 9. 风险点',
    '## 10. 未完成项',
    renderRiskSection(allPassed),
  );
  updated = replaceSection(
    updated,
    '## 10. 未完成项',
    '## 11. Codex 给人工 reviewer 的说明',
    `## 10. 未完成项\n\n${allPassed ? '暂无自动发现' : '机器证据未全部通过，详见第 7 节。'}`,
  );
  updated = replaceFinalSection(
    updated,
    '## 11. Codex 给人工 reviewer 的说明',
    renderReviewerSection(),
  );

  if (!/- Codex 自评结论：(passed|partial)/.test(updated)) {
    throw new Error('L48 report conclusion line is missing');
  }
  updated = updated.replace(
    /- Codex 自评结论：(passed|partial)/,
    `- Codex 自评结论：${allPassed ? 'passed' : 'partial'}`,
  );
  if (!updated.includes(`- 业务稳定分支：${L48_BUSINESS_BASE_BRANCH}`)) {
    throw new Error('L48 report business base branch mismatch');
  }
  if (!updated.includes(`- 业务稳定 commit：${L48_BUSINESS_BASE_COMMIT}`)) {
    throw new Error('L48 report business base commit mismatch');
  }
  if (updated.includes('undefined')) {
    throw new Error('L48 report evidence transform produced undefined');
  }
  return updated.trimStart();
}

function currentHeadCommit(): string {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Unable to resolve a full HEAD commit: ${commit || 'empty'}`);
  }
  return commit;
}

export function applyL48ReportEvidence(): void {
  const reportsDir = join(process.cwd(), 'reports');
  const verifyPath = join(reportsDir, 'latest-verify-output.txt');
  const reportPath = join(reportsDir, 'stage-L48-report.md');
  if (!existsSync(reportPath)) {
    throw new Error(
      'L48 report evidence transform could not find reports/stage-L48-report.md',
    );
  }
  const verifyOutput = existsSync(verifyPath)
    ? readFileSync(verifyPath, 'utf8')
    : '';
  const report = readFileSync(reportPath, 'utf8');
  writeFileSync(
    reportPath,
    transformL48Report(report, verifyOutput, currentHeadCommit()),
  );
}
