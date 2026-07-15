from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing target in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

stage = 'scripts/stage-workflow.ts'
replace_once(
    stage,
    "  if (spec.successMessage) printAndAppend(`${spec.successMessage}\\n`);\n}",
    "  if (spec.successMessage) printAndAppend(`${spec.successMessage}\\n`);\n  printAndAppend(`command_completed:${spec.title}=true\\n`);\n}",
)
replace_once(
    stage,
    "function runVerify(args: ParsedArgs, publishMode = false): void {\n  prepareLatestOutput();\n  for (const command of resolveVerifyCommands(args, publishMode)) runCommand(command);\n  printAndAppend('\\nStage workflow verification passed.\\n');\n}",
    "function runVerify(args: ParsedArgs, publishMode = false): void {\n  prepareLatestOutput();\n  for (const command of resolveVerifyCommands(args, publishMode)) runCommand(command);\n  const resolvedScope: Scope = args.all ? 'all' : (args.scope ?? (publishMode ? 'chain' : 'stage'));\n  if (args.stage && resolvedScope === 'chain') printAndAppend(`L24-${args.stage} chain regression passed.\\n`);\n  printAndAppend('\\nStage workflow verification passed.\\n');\n}",
)

report = 'scripts/generate-stage-report.ts'
p = Path(report)
text = p.read_text()
anchor = "function commandPassedInSectionOnly(content: string, title: string, successMarkers: string[], requireAllMarkers = false): StageVerifyStatus {\n"
helper = "function commandCompleted(content: string, title: string) {\n  return content.includes(`command_completed:${title}=true`);\n}\n\nfunction l45DockerRequiredMarkers() {\n  return ['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', ...l45ConcurrentRuntimeMarkers(), ...L45_API_CONTRACT_LIST.flatMap((api) => api.runtime_markers_required)];\n}\n\nfunction l45MissingDockerMarkers(content: string) {\n  return l45DockerRequiredMarkers().filter((marker) => !content.includes(marker));\n}\n\n"
if anchor not in text:
    raise SystemExit('missing report helper anchor')
text = text.replace(anchor, helper + anchor, 1)
old_l45 = """  if (isL45Stage) {
    return [
      { command: 'L45 verifier', result: commandPassed(content, 'L45 verifier', ['L45 manual tax review export verifier passed.']) },
      { command: 'L24-L45 chain regression', result: commandPassed(content, 'L24-L45 chain regression', ['L45 manual tax review export verifier passed.', 'L44 manual withdrawal review verifier passed.', 'L43 reward ledger T3 refund deduct verification passed.', 'L24 miniapp cart verification passed.', 'Stage workflow verification passed.'], true) },
      { command: 'Docker API E2E', result: commandPassed(content, 'Docker API E2E', ['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', ...l45ConcurrentRuntimeMarkers(), ...L45_API_CONTRACT_LIST.flatMap((api) => api.runtime_markers_required)], true) },
      { command: 'Admin typecheck config', result: commandPassed(content, 'Admin typecheck config', ['Admin typecheck config check passed.']) },
      { command: 'Admin full typecheck', result: detectAdminTypecheck(content) },
      { command: 'raw compliance scan', result: commandPassedInSectionOnly(content, 'raw compliance scan', ['raw compliance scan passed.']) },
      { command: 'Stage workflow', result: commandPassed(content, 'Stage workflow', ['Stage workflow verification passed.']) }
    ];
  }
"""
new_l45 = """  if (isL45Stage) {
    const dockerMarkersComplete = l45MissingDockerMarkers(content).length === 0;
    return [
      { command: 'L45 verifier', result: commandCompleted(content, 'L45 verifier') && content.includes('L45 manual tax review export verifier passed.') ? 'passed' : 'not detected' },
      { command: 'L24-L45 chain regression', result: content.includes('L24-L45 chain regression passed.') ? 'passed' : 'not detected' },
      { command: 'Docker API E2E', result: commandCompleted(content, 'Docker API E2E') && dockerMarkersComplete ? 'passed' : 'not detected' },
      { command: 'Admin typecheck config', result: commandCompleted(content, 'Admin typecheck config check') && content.includes('Admin typecheck config check passed.') ? 'passed' : 'not detected' },
      { command: 'Admin full typecheck', result: commandCompleted(content, 'Admin typecheck') && content.includes('Admin typecheck passed.') ? 'passed' : 'not detected' },
      { command: 'raw compliance scan', result: commandCompleted(content, 'raw compliance scan') && content.includes('raw compliance scan passed.') ? 'passed' : 'not detected' },
      { command: 'Stage workflow', result: content.includes('Stage workflow verification passed.') ? 'passed' : 'not detected' }
    ];
  }
"""
if old_l45 not in text:
    raise SystemExit('missing L45 stageVerifyChecks block')
text = text.replace(old_l45, new_l45, 1)
old_assert = "      assertReportQuality(verifyOutput.rows.every((row) => row.result === 'passed'), 'All L45 verification rows must pass');"
new_assert = "      const failingRows = verifyOutput.rows.filter((row) => row.result !== 'passed');\n      const missingDockerMarkers = l45MissingDockerMarkers(verifyOutput.raw ?? '');\n      assertReportQuality(failingRows.length === 0, ['All L45 verification rows must pass', `rows=${verifyOutput.rows.map((row) => `${row.command}:${row.result}`).join(',')}`, `missingDockerMarkers=${missingDockerMarkers.join(',') || 'none'}`].join(' | '));"
if old_assert not in text:
    raise SystemExit('missing L45 row assertion')
text = text.replace(old_assert, new_assert, 1)
p.write_text(text)

verifier = 'scripts/verify-l45-manual-tax-review-export-local.ts'
p = Path(verifier)
text = p.read_text()
anchor = "assert(report.includes('apiRows.length === L45_API_CONTRACT_LIST.length'), 'L45 report API row count must come from contract length');\n"
addition = anchor + "assert(report.includes('function commandCompleted(') && report.includes('l45MissingDockerMarkers') && report.includes('L24-L45 chain regression passed.') && report.includes('rows=${verifyOutput.rows.map') && report.includes('missingDockerMarkers=${missingDockerMarkers.join'), 'L45 report rows must use authoritative command completion markers and actionable failure diagnostics');\nconst stageWorkflow = readFileSync('scripts/stage-workflow.ts', 'utf8');\nassert(stageWorkflow.includes('command_completed:${spec.title}=true') && stageWorkflow.includes('L24-${args.stage} chain regression passed.'), 'stage workflow must emit authoritative command and chain completion markers');\n"
if anchor not in text:
    raise SystemExit('missing L45 verifier report anchor')
p.write_text(text.replace(anchor, addition, 1))

doc = 'docs/dev/stage-verifier-compatibility.md'
p = Path(doc)
text = p.read_text()
append = """

## 15. 阶段报告命令证据规范

- 阶段工作流必须在命令退出码为 0 后写入机器可读的命令完成 marker；报告不得仅凭日志中零散成功文案猜测命令是否通过。
- 合并回归链必须有独立的 chain completion marker，并且只能在链内全部命令成功后输出。
- 报告解析器不得在找不到目标命令 section 时退化为扫描整份日志；正常的负向 API 测试、预期 4xx 和 ORM 回滚信息不得污染无关验证行。
- Docker API E2E 行除命令完成 marker 外，仍必须验证机器契约要求的全部业务 runtime markers，不能只看进程退出码。
- 报告质量断言失败时必须输出每一验证行的状态，并列出缺失 runtime markers，禁止只返回“所有行必须通过”的无诊断总句。
"""
if '## 15. 阶段报告命令证据规范' not in text:
    text += append
p.write_text(text)
