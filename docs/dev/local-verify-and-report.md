# 本地 verify 与阶段报告发布

本项目提供三个本地脚本，用于固定本地 verify 和阶段报告发布所需的网络环境变量，避免每次手动输入同一组命令。

## 为什么使用 127.0.0.1 而不是 localhost

本地 verify 访问 API health check 时固定使用 `127.0.0.1`，默认地址为：

```bash
http://127.0.0.1:13080
```

这样做是为了避免不同环境中 `localhost` 解析差异导致的不稳定问题，例如：

- `localhost` 可能优先解析到 IPv6 `::1`，但本地服务实际只监听 IPv4。
- 代理工具可能拦截 `localhost` 请求，导致 health check 看起来像超时。
- shell、Node.js、curl 或系统网络配置对 `localhost` / IPv6 / 代理的处理不一致。

脚本默认设置：

```bash
API_PORT=13080
API_HOST=127.0.0.1
API_BASE_URL=http://127.0.0.1:13080
NO_PROXY=localhost,127.0.0.1,::1
no_proxy=localhost,127.0.0.1,::1
```

这些默认值都允许外部环境变量覆盖。

## 使用方式

只运行本地 verify，并把输出保存到 `reports/latest-verify-output.txt`：

```bash
bash scripts/local-verify.sh
```

发布指定阶段报告，默认阶段为 `L15`：

```bash
bash scripts/local-publish-stage-report.sh L15
```

一键执行 L15 verify 并发布阶段报告：

```bash
bash scripts/local-verify-and-publish-l15.sh
```

## reports/ 不要提交

`reports/` 是本地 verify 和报告发布流程使用的临时目录。`reports/latest-verify-output.txt` 用于给发布脚本读取最近一次 verify 输出，不应提交到代码仓库。

## package 文件不应被 verify 修改

运行 verify 或报告发布脚本时，不应修改：

- `package.json`
- `pnpm-lock.yaml`

如果发现这些文件出现修改，请先停止发布流程，并检查本地 Node.js、pnpm、Corepack、依赖安装或网络代理环境，不要把这些非预期修改提交。
