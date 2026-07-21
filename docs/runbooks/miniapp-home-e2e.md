# 春华秋实首页点击冒烟测试

该测试使用微信开发者工具真实启动小程序，点击首页“全部商品、今日开团、我的订单”三个稳定业务入口，并验证目标页面路径。它不会调用真实支付、分享、登录或退款。

## 首次准备

1. 在 Mac 安装并登录微信开发者工具。
2. 在开发者工具安全设置中开启 CLI/服务端口能力。
3. 从仓库根目录执行 `pnpm setup:miniapp:e2e`。该命令只安装点击框架自己的依赖，不修改根 `pnpm-lock.yaml`。
4. 确认本地 API 测试环境可访问；即使商品或团购摘要加载失败，三个固定入口仍应可点击。

## 运行

```bash
WECHAT_CLI_PATH="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
MINIAPP_PROJECT_PATH="$PWD/apps/miniapp" \
MINIAPP_AUTOMATION_PORT=9420 \
pnpm e2e:miniapp:home

echo "miniapp_home_e2e_exit=$?"
```

预期：

```text
miniapp_home_e2e_exit=0
```

## 失败证据

默认写入：

```text
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.log
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.png
```

日志包含当前页面路径、页面数据的字段/数组长度摘要、控制台事件、未捕获异常和调用栈，不记录完整订单或用户字段。可通过 `MINIAPP_E2E_OUTPUT_DIR` 改变输出目录。

常见失败：

- `requires macOS`：真实微信开发者工具测试不能在普通 Linux CI 运行。
- `CLI not found`：检查 `WECHAT_CLI_PATH`，部分安装目录名称可能不同。
- `automation enabled`：开发者工具未打开自动化/服务端口权限。
- `Port 9420 is in use`：换一个 `MINIAPP_AUTOMATION_PORT`。
- `Missing Mini Program element`：页面未编译成功，或稳定 `data-testid` 被误删。

Linux/Docker 只运行 `pnpm verify:l49:static`、纯函数测试和已有业务门禁；待自托管 Mac Runner 建立后，再把本命令接入 GitHub Actions。
