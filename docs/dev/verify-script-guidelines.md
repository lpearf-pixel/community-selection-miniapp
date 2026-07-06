# Verify Script Guidelines

新阶段 verify 脚本必须复用 `scripts/lib/compliance-scan.ts` 中的 `scanComplianceFiles(files)` 执行合规扫描。

## 合规扫描要求

- 不要在 verify 脚本中重复手写 forbidden terms 数组。
- forbidden terms 不能在源码中写未拆分原文，必须使用 `scripts/lib/compliance-scan.ts` 已维护的拆分字面量。
- verify 脚本本身也会被扫描，因此脚本内不能出现未拆分的敏感词原文。
- 禁止通过排除当前 verify 脚本来绕过合规扫描。

## 新阶段建议流程

1. 在 verify 脚本中导入：

   ```ts
   import { scanComplianceFiles } from './lib/compliance-scan.js';
   ```

2. 明确列出本阶段新增/修改的源文件、脚本和文档。
3. 调用 `scanComplianceFiles(files)`。
4. 确认输出包含 `Compliance scan passed.`。
