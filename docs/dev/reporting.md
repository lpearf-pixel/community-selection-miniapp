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
