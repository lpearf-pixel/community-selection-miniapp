# 阶段报告机制

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

## 4. 查看报告

切到报告分支：

```bash
git fetch origin stage-reports
git switch stage-reports
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
- 发布前建议先保存完整 verify 输出，便于 reviewer 对照报告结论。
