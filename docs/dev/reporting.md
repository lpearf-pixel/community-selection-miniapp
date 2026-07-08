# 阶段报告机制

## 推荐发布流程

开发分支先同步：

```bash
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --ff-only origin "$CURRENT_BRANCH"
```

运行验收并保存日志：

```bash
mkdir -p reports
pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
```

发布报告：

```bash
pnpm report:publish -- --stage=L15 --push
```

或者让 publish 脚本自动拉当前分支：

```bash
pnpm report:publish -- --stage=L15 --pull-source --push
```

## 1. 本地生成报告

```bash
mkdir -p reports
pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
pnpm report:stage -- --stage=L15
```

## 2. 发布到本地 stage-reports 分支

```bash
pnpm report:publish -- --stage=L15
```

## 3. 发布到远端 stage-reports 分支

```bash
pnpm report:publish -- --stage=L15 --push
```

## 4. 查看远端报告

```bash
git fetch origin stage-reports
git switch stage-reports
git pull --ff-only origin stage-reports
```

查看：

```text
reports/L15/latest.md
reports/L15/latest-verify-output.txt
```

## 5. 给人工 reviewer

以后不需要手动复制整份报告。只需要告诉 reviewer：

- 报告分支：stage-reports
- 阶段：L15
- 文件：
  - reports/L15/latest.md
  - reports/L15/latest-verify-output.txt

## 6. 注意事项

- 开发分支只提交脚本和文档，不长期保存 `reports/` 产物。
- 发布脚本使用 git worktree 操作 `stage-reports`，不会直接切换当前开发工作区。
- 默认不 push；需要上传远端时显式添加 `--push`。
- 默认只检查当前分支是否落后远端，不自动 pull；需要自动快进当前分支时显式添加 `--pull-source`。
- `--pull-source` 只用于发布前尝试快进当前分支。如果它实际拉取了新 commit，脚本会中止，并要求重新运行 verify:all。
- 为了保证报告和验收日志对应同一个 commit，更推荐先手动 git pull，再运行 verify。
- 发布前建议先保存完整 verify 输出，便于 reviewer 对照报告结论。

## Verify and compliance scan guardrails

Before generating or publishing a stage report / verify output, run the local verification flow first so reports are based on a checked workspace.

Stage verify scripts and report-related tooling should reuse `scripts/lib/compliance-scan.ts` for forbidden-term checks. Do not write unsplit forbidden terms directly in report generators or verify scripts; the verify scripts themselves may be scanned, so terms must remain split at the source level.

## Stage workflow

`scripts/stage-workflow.ts` is a thin orchestrator for stage verification, latest verify output capture, report generation, and optional report publishing. It does not replace `report:stage` or `report:publish`; it calls them after verification.

Run only L27:

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L27 --verify
"
```

Run the L27 regression chain:

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L27 --verify --scope=chain
"
```

Run all registered stage verifiers plus shared checks:

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --verify --all
"
```

Publish L27 without pushing:

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L27 --publish
"
```

Publish L27 and push the report branch:

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L27 --publish --push
"
```

Options:

- `--scope=stage` runs only the selected stage verifier.
- `--scope=chain` runs the selected stage, its regression chain, Docker API E2E, and admin typecheck.
- `--scope=all` runs every registered stage verifier, Docker API E2E, and admin typecheck.
- `--all` is equivalent to `--verify --scope=all` and must not be combined with `--stage`.
- `--publish` automatically runs verify first, writes `reports/latest-verify-output.txt`, runs `pnpm report:stage -- --stage=<stage>`, and runs `pnpm report:publish -- --stage=<stage> --skip-source-sync-check`.
- `--push` appends `--push` to the publish command.
- `--skip-source-sync-check=false` disables the default publish-time `--skip-source-sync-check` flag when a strict source sync check is required.
- `reports/` is generated output and must not be committed to business branches.
