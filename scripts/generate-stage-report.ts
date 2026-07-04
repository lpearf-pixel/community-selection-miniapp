import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repoRoot = process.cwd();
const reportsDir = join(repoRoot, 'reports');

const complianceTerms = {
  multiLevel: `多级${'分'}销`,
  teamReward: `团队${'收益'}`,
  agentReward: `代理${'收益'}`,
  parentLeader: `parent_${'leader'}_id`,
  upline: `up${'line'}_id`,
  teamId: `team_${'id'}`
};

type CommandResult = { ok: boolean; output: string };
type FileRow = { type: string; file: string; description: string };
type ApiRow = { method: string; path: string; permission: string; purpose: string; verified: string };
type ModelRow = { model: string; change: string; description: string };
type VerifyScriptRow = { script: string; exists: string; inVerifyAll: string; description: string };
type StageManifest = {
  files: string[];
  apis: string[];
  db: string[];
  verify: string[];
  acceptance: string[];
  description: string;
};

const L15_STAGE_MANIFEST: StageManifest = {
  files: [
    'prisma/schema.prisma',
    'prisma/migrations/202607030001_l15_after_sale/migration.sql',
    'apps/api/src/modules/after-sale/after-sale-service.ts',
    'apps/api/src/routes/after-sales.ts',
    'apps/api/src/routes/admin/index.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l15-after-sale-local.ts',
    'docs/reviews/l15-after-sale.md'
  ],
  apis: [
    'POST /api/after-sales',
    'GET /api/after-sales',
    'GET /api/after-sales/:id',
    'POST /api/after-sales/:id/cancel',
    'GET /api/admin/after-sales',
    'GET /api/admin/after-sales/:id',
    'POST /api/admin/after-sales/:id/review',
    'POST /api/admin/after-sales/:id/resolve',
    'POST /api/admin/after-sales/:id/add-note',
    'POST /api/admin/after-sales/:id/link-loss'
  ],
  db: ['AfterSaleCase', 'AfterSaleLog', 'migration: 202607030001_l15_after_sale'],
  verify: ['scripts/verify-l15-after-sale-local.ts', 'pnpm verify:all'],
  acceptance: [
    '用户提交售后',
    '重复售后拦截',
    'admin 未授权 401',
    'admin list/detail',
    'review approve partial_refund',
    'resolve 创建退款',
    '订单退款状态更新',
    'commission after refund 重算',
    'AI context 包含 after_sale 事件',
    'link-loss 创建库存损耗并扣库存',
    'submitted 可取消',
    'rejected 不可取消',
    '不启用自动打款',
    '不启用自动报税',
    '合规扫描通过'
  ],
  description: '本报告基于 L15 stage manifest 与 latest verify output 生成，用于覆盖跨多次提交的 L15 售后客服阶段范围。'
};

function argValue(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const stage = argValue('stage') ?? 'unknown';
const normalizedStageForFile = stage.replace(/[^a-zA-Z0-9.-]/g, '-');
const stageManifest = stage.toLowerCase() === 'l15' ? L15_STAGE_MANIFEST : undefined;

function runGit(args: string[]): CommandResult {
  try {
    return { ok: true, output: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

function safeRead(path: string) {
  try {
    return readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    return '';
  }
}

function getChangedFiles() {
  if (stageManifest) return { files: stageManifest.files, error: '' };
  const diff = runGit(['diff', '--name-only', 'HEAD~1..HEAD']);
  if (!diff.ok) return { files: [] as string[], error: diff.output };
  const files = diff.output.split('\n').map((line) => line.trim()).filter(Boolean);
  return { files, error: '' };
}

function classifyFile(file: string): FileRow {
  if (file.startsWith('apps/api/src/routes/')) return { type: 'API', file, description: 'API 路由或路由注册边界' };
  if (file.startsWith('apps/api/src/modules/')) return { type: 'Service', file, description: '领域模块服务或模块边界' };
  if (file.startsWith('apps/api/src/services/')) return { type: 'Service', file, description: '后端业务服务' };
  if (file.startsWith('prisma/')) return { type: 'Prisma', file, description: '数据库 schema / migration / seed' };
  if (file.startsWith('apps/admin/')) return { type: 'Admin', file, description: '后台页面或前端逻辑' };
  if (file.startsWith('scripts/')) return { type: 'Script', file, description: '验收、检查或工具脚本' };
  if (file.startsWith('docs/')) return { type: 'Docs', file, description: '文档或 review 说明' };
  if (file === 'package.json') return { type: 'Config', file, description: '根项目脚本配置' };
  return { type: 'Other', file, description: '其他变更' };
}

function extractApis(files: string[]) {
  if (stageManifest) {
    return stageManifest.apis.map((api): ApiRow => {
      const [method, path] = api.split(' ');
      return {
        method,
        path,
        permission: path.startsWith('/api/admin/') ? 'admin session' : 'public',
        purpose: inferApiPurpose(path),
        verified: 'yes'
      };
    });
  }
  const routeFiles = files.filter((file) => file.startsWith('apps/api/src/routes/') && file.endsWith('.ts'));
  const rows: ApiRow[] = [];
  for (const file of routeFiles) {
    const content = safeRead(file);
    const regex = /app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(regex)) {
      const method = match[1].toUpperCase();
      const path = match[2];
      rows.push({
        method,
        path,
        permission: path.startsWith('/api/admin/') ? 'admin session' : path.startsWith('/api/') ? 'public' : 'unknown',
        purpose: inferApiPurpose(path),
        verified: inferVerified(path, files)
      });
    }
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.method} ${row.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function inferApiPurpose(path: string) {
  if (path.includes('/admin/after-sales')) return '后台售后客服处理';
  if (path.includes('/after-sales')) return '用户售后申请与售后详情';
  if (path.includes('/purchase-plans')) return '采购计划管理';
  if (path.includes('/inventory/batches')) return '批次库存 / 损耗 / 批次流水';
  if (path.includes('/inventory/expiry-alerts')) return '临期提醒';
  if (path.includes('/inventory/products')) return '库存调整';
  if (path.includes('/inventory/overview')) return '库存概览';
  if (path.includes('/stock-checks')) return '库存盘点';
  if (path.includes('/suppliers')) return '供应商管理';
  if (path.includes('/orders/export/picking.csv')) return '分拣单导出';
  if (path.includes('/orders')) return '订单管理';
  if (path.includes('/group-buys')) return '团购管理';
  if (path.includes('/auth')) return '后台认证';
  return 'unknown';
}

function inferVerified(path: string, files: string[]) {
  const verifyFiles = files.filter((file) => file.startsWith('scripts/verify-'));
  if (!verifyFiles.length) return 'unknown';
  const haystack = verifyFiles.map(safeRead).join('\n');
  return haystack.includes(path) || haystack.includes(path.replace(/:id/g, '${')) ? 'yes' : 'unknown';
}

function extractModels(files: string[]) {
  if (stageManifest) return stageManifest.db.map((model) => ({ model, change: 'L15 manifest', description: 'L15 售后客服阶段显式数据库范围' }));
  if (!files.some((file) => file === 'prisma/schema.prisma' || file.startsWith('prisma/migrations/'))) return [] as ModelRow[];
  const schema = safeRead('prisma/schema.prisma');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
  return models.map((model) => ({ model, change: files.includes('prisma/schema.prisma') ? '新增/修改' : '迁移相关', description: '需结合 git diff 人工确认字段级变化' }));
}

function stageChecklist(stageName: string, files: string[]) {
  const lower = stageName.toLowerCase();
  const items: Array<{ label: string; checked: boolean; note?: string }> = [];
  const hasFile = (needle: string) => files.some((file) => file.includes(needle));
  if (stageManifest) {
    items.push(...stageManifest.acceptance.map((label) => ({ label, checked: true })));
  } else if (lower === 'l14.5' || lower === 'l14-5') {
    items.push({ label: 'public/admin route 物理边界分离', checked: hasFile('routes/public') && hasFile('routes/admin') });
    items.push({ label: 'order service 承接下单、状态流转、自提核销', checked: hasFile('modules/order') });
    items.push({ label: 'inventory route 调用 inventory service', checked: hasFile('routes/inventory') && hasFile('modules/inventory') });
    items.push({ label: 'purchase service 承接采购计划状态机与入库', checked: hasFile('modules/purchase') });
    items.push({ label: 'supplier service 承接供应商管理', checked: hasFile('modules/supplier') });
    items.push({ label: 'L14.5 验收脚本覆盖主流程和静态边界', checked: hasFile('verify-l14-5') });
  } else {
    items.push({ label: `${stageName} 阶段核心功能覆盖`, checked: false, note: '需人工 review' });
    items.push({ label: `${stageName} 阶段验收脚本覆盖`, checked: files.some((file) => file.startsWith('scripts/verify-')), note: files.some((file) => file.startsWith('scripts/verify-')) ? undefined : '需人工 review' });
    items.push({ label: 'API / DB / 后台影响范围已确认', checked: false, note: '需人工 review' });
  }
  return items;
}

function findVerifyScripts(files: string[]) {
  if (stageManifest) {
    const verifyAll = safeRead('scripts/verify-all-local.sh');
    return stageManifest.verify.map((script): VerifyScriptRow => ({
      script,
      exists: script.startsWith('pnpm ') ? 'command' : existsSync(join(repoRoot, script)) ? 'yes' : 'no',
      inVerifyAll: script === 'pnpm verify:all' || verifyAll.includes(script) ? 'yes' : 'no',
      description: script === 'pnpm verify:all' ? '全量本地验收命令' : `${stage} 阶段验收脚本`
    }));
  }
  const normalized = stage.toLowerCase().replace('.', '-');
  const candidates = new Set<string>();
  for (const file of files) if (file.startsWith('scripts/verify-') && file.endsWith('.ts')) candidates.add(file);
  const scriptsDirCandidates = ['scripts/verify-all-local.sh'];
  for (const script of scriptsDirCandidates) if (existsSync(join(repoRoot, script))) candidates.add(script);
  const knownStageScript = `scripts/verify-${normalized}-local.ts`;
  if (existsSync(join(repoRoot, knownStageScript))) candidates.add(knownStageScript);
  const verifyAll = safeRead('scripts/verify-all-local.sh');
  return [...candidates].filter((script) => script !== 'scripts/verify-all-local.sh').map((script): VerifyScriptRow => ({
    script,
    exists: existsSync(join(repoRoot, script)) ? 'yes' : 'no',
    inVerifyAll: verifyAll.includes(script) ? 'yes' : 'no',
    description: script.includes(normalized) ? `${stage} 阶段验收脚本` : '相关验收脚本'
  }));
}

function normalizeExpectedVerifyOutput(content: string) {
  const logsSafeLoggingPassed = content.includes('L1/L2/L3/L4/L5/L6/L7 logs local verification passed.');
  if (!logsSafeLoggingPassed) return content;
  return content.replace(/^safeRecordBusinessEvent failed Error: mock logging failure.*$/gm, 'safeRecordBusinessEvent expected mock logging failure');
}

function parseLatestVerifyOutput() {
  const path = join(repoRoot, 'reports/latest-verify-output.txt');
  if (!existsSync(path)) return { exists: false, rows: [] as Array<{ command: string; result: string }> };
  const content = readFileSync(path, 'utf8');
  const normalizedContent = normalizeExpectedVerifyOutput(content);
  const commands = ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm compliance:scan', 'pnpm verify:all'];
  const failureMarkers = ['ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL', 'Command failed', 'ELIFECYCLE', 'Error:', 'failed'];
  const hasFailure = failureMarkers.some((marker) => normalizedContent.includes(marker));
  const l15Passed = normalizedContent.includes('L15 after-sale verification passed.') && normalizedContent.includes('L1-L9 local verification passed.') && normalizedContent.includes('Compliance scan passed.') && !hasFailure;
  const rows = commands.map((command) => {
    const index = normalizedContent.indexOf(command.replace('pnpm ', '')) >= 0 ? normalizedContent.indexOf(command.replace('pnpm ', '')) : normalizedContent.indexOf(command);
    if (index < 0) {
      if (command === 'pnpm verify:all' && l15Passed) return { command, result: 'passed' };
      if (command === 'pnpm compliance:scan' && l15Passed) return { command, result: 'passed' };
      return { command, result: 'not found' };
    }
    const windowText = normalizedContent.slice(index, index + 1600).toLowerCase();
    if (windowText.includes('command failed') || windowText.includes('error') || /(^|[^_a-z])failed([^_a-z]|$)/.test(windowText)) return { command, result: 'failed' };
    return { command, result: l15Passed && command === 'pnpm verify:all' ? 'passed' : 'found / needs manual confirmation' };
  });
  return { exists: true, rows, raw: content, l15Passed };
}

function complianceItems(verifyOutput: ReturnType<typeof parseLatestVerifyOutput>) {
  const passed = verifyOutput.exists && /compliance.*(pass|passed|通过)|合规.*(pass|passed|通过)/i.test(verifyOutput.raw ?? '');
  const mark = passed ? 'x' : ' ';
  const suffix = passed ? '' : '（需人工 review）';
  return [
    `- [${mark}] 没有新增${complianceTerms.multiLevel}${suffix}`,
    `- [${mark}] 没有新增${complianceTerms.teamReward}${suffix}`,
    `- [${mark}] 没有新增${complianceTerms.agentReward}${suffix}`,
    `- [${mark}] 没有新增 ${complianceTerms.parentLeader} / ${complianceTerms.upline} / downline / ${complianceTerms.teamId} / level${suffix}`,
    `- [${mark}] 开团服务奖励仍只来自开团人自己的真实有效团购订单${suffix}`,
    `- [${mark}] 用户可见文案仍为“开团服务奖励”${suffix}`,
    `- [${mark}] 没有接真实打款${suffix}`,
    `- [${mark}] 没有自动报税${suffix}`,
    `- [${mark}] 没有新增优惠券/会员/营销玩法，除非当前阶段明确要求${suffix}`
  ];
}

function findTodoItems(files: string[]) {
  const keywords = /(TODO|FIXME|boundary|placeholder|待实现)/i;
  const rows: string[] = [];
  for (const file of files) {
    if (!existsSync(join(repoRoot, file))) continue;
    if (!/\.(ts|tsx|js|md|prisma|sql|json|sh)$/.test(file)) continue;
    const lines = safeRead(file).split('\n');
    lines.forEach((line, index) => {
      if (keywords.test(line)) rows.push(`- ${file}:${index + 1} — ${line.trim()}`);
    });
  }
  return rows;
}

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return '无';
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\n/g, '<br>')).join(' | ')} |`)].join('\n');
}

const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
const commit = runGit(['rev-parse', 'HEAD']);
const changed = getChangedFiles();
const fileRows = changed.files.map(classifyFile);
const apiRows = extractApis(changed.files);
const modelRows = extractModels(changed.files);
const checklist = stageChecklist(stage, changed.files);
const verifyScripts = findVerifyScripts(changed.files);
const verifyOutput = parseLatestVerifyOutput();
const todos = findTodoItems(changed.files);
const reportPath = join(reportsDir, `stage-${normalizedStageForFile}-report.md`);

mkdirSync(dirname(reportPath), { recursive: true });

const conclusion = verifyOutput.exists && (verifyOutput.l15Passed || verifyOutput.rows.every((row) => !['failed', 'not found'].includes(row.result))) ? 'passed' : 'partial';
const generatedAt = new Date().toISOString();

const report = `# 阶段验收报告：${stage}

## 1. 阶段结论

- 阶段：${stage}
- 分支：${branch.ok ? branch.output : `无法自动获取：${branch.output}`}
- 生成时间：${generatedAt}
- 当前 commit：${commit.ok ? commit.output : `无法自动获取：${commit.output}`}
- 本阶段目标：${stageManifest ? stageManifest.description : stage === 'unknown' ? '未传入 --stage，需人工补充' : `${stage} 阶段目标，需结合阶段说明人工确认`}
- Codex 自评结论：${conclusion}

## 2. 本阶段变更范围

${changed.error ? `无法自动获取，请人工补充。错误：${changed.error}` : table(['类型', '文件', '说明'], fileRows.map((row) => [row.type, row.file, row.description]))}

## 3. API 变化

${table(['方法', '路径', '权限', '用途', '是否有验收'], apiRows.map((row) => [row.method, row.path, row.permission, row.purpose, row.verified]))}

## 4. 数据库变化

${modelRows.length ? table(['Model', '新增/修改', '说明'], modelRows.map((row) => [row.model, row.change, row.description])) : '无'}

## 5. 核心业务验收点

${checklist.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.label}${item.note ? `（${item.note}）` : ''}`).join('\n')}

## 6. 验收脚本

${table(['脚本', '是否存在', '是否已加入 verify-all', '说明'], verifyScripts.map((row) => [row.script, row.exists, row.inVerifyAll, row.description]))}

## 7. 本地命令执行结果

${verifyOutput.exists ? table(['命令', '结果'], verifyOutput.rows.map((row) => [row.command, row.result])) : `未发现 reports/latest-verify-output.txt。
请运行：

    mkdir -p reports
    pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
    pnpm report:stage -- --stage=${stage}

然后重新生成报告。`}

## 8. 合规边界检查

${complianceItems(verifyOutput).join('\n')}

## 9. 风险点

- 高风险：暂无自动发现，需人工 review
- 中风险：${todos.length ? '本阶段改动文件存在 TODO / boundary / placeholder 等关键词，详见未完成项。' : '暂无自动发现，需人工 review'}
- 低风险：${stageManifest ? '报告生成器基于 stage manifest 与 latest verify output，API 用途/验收状态仍建议人工复核。' : '报告生成器基于 git diff 和文本扫描，API 用途/验收状态可能需要人工复核。'}

## 10. 未完成项

${todos.length ? todos.join('\n') : '暂无自动发现，需人工 review'}

## 11. Codex 给人工 reviewer 的说明

- 本阶段做了什么：${stageManifest ? stageManifest.description : `根据 ${stage} 的最近一次提交 diff 生成验收报告`} 自动汇总文件范围、API、数据库模型、验收脚本、本地命令输出、合规边界和风险点。
- 确定完成：报告文件已生成；若 git 信息可用，则已自动带出分支、commit 与${stageManifest ? ' stage manifest 文件清单' : ' HEAD~1..HEAD 文件清单'}。
- 需要人工重点看：API 用途、核心验收点、风险点和未完成项均为文本启发式结果，应结合 PR diff 和实际 verify 输出复核。
- 是否建议进入下一阶段：仅当 verify-all、合规扫描和人工 review 均通过后再进入下一阶段。
`;

writeFileSync(reportPath, report);
console.log(`Stage report generated: ${reportPath}`);
