# 春华秋实首页点击冒烟测试

该测试由两部分组成：PostgreSQL 与 API 使用 Docker Compose 容器启动；微信开发者工具和点击驱动运行在 Mac 宿主机。测试会点击首页“全部商品、今日开团、我的订单”三个稳定业务入口并验证目标页面路径，不会调用真实支付、分享、登录或退款。

## 首次准备

1. 在 Mac 安装并启动 Docker Desktop，确认 `docker compose version` 可执行。
2. 安装并登录微信开发者工具，在安全设置中开启 CLI/服务端口能力，并为本地开发关闭合法域名校验。
3. 从仓库根目录执行 `pnpm setup:miniapp:e2e`。该命令只安装点击框架自己的依赖，不修改根 `pnpm-lock.yaml`。
4. 确认宿主机端口 `13080` 和 `15432` 未被其他程序占用。

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

主命令会依次执行：

1. `docker compose up -d --wait postgres api`，不会启动后台管理端。
2. 再从 Mac 宿主机检查 `http://127.0.0.1:13080/api/health`。
3. 启动微信开发者工具并执行首页点击冒烟。
4. 测试结束后保留 PostgreSQL/API 容器，便于继续开发和复测。

容器已经健康时，可只跑页面点击：

```bash
pnpm e2e:miniapp:home:click-only
```

开发结束后停止测试容器：

```bash
pnpm e2e:miniapp:stop
```

停止命令只执行 `docker compose stop postgres api`，不会停止或移除同一项目中的 `admin`，也不会删除容器、网络或 PostgreSQL 等命名卷；如需移除数据卷，必须另行人工确认后操作。

可选环境变量：

- `MINIAPP_E2E_COMPOSE_FILE`：Compose 文件路径，默认 `$PWD/docker-compose.yml`。
- `MINIAPP_E2E_COMPOSE_WAIT_SECONDS`：Compose 健康等待秒数，默认 `300`。
- `MINIAPP_E2E_HEALTH_URL`：宿主机 API 健康地址，默认 `http://127.0.0.1:13080/api/health`。
- `MINIAPP_E2E_HEALTH_TIMEOUT_MS`：额外健康探针等待毫秒数，默认 `30000`。

## 失败证据

默认写入：

```text
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.log
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.png
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>-compose.log
```

小程序日志包含当前页面路径、页面数据的字段/数组长度摘要、控制台事件、未捕获异常和调用栈，不记录完整订单或用户字段。容器失败或点击失败时，Compose 诊断文件包含 `docker compose ps` 以及 PostgreSQL/API 最后 200 行日志。可通过 `MINIAPP_E2E_OUTPUT_DIR` 改变输出目录。

常见失败：

- `requires macOS`：真实微信开发者工具测试不能在普通 Linux CI 运行。
- `Unable to run Docker`：Docker Desktop 尚未启动，或 `docker` 不在 PATH 中。
- `Docker exited with status`：查看输出的 `-compose.log`，重点检查端口占用、依赖安装与数据库迁移。
- `API health check timed out`：Compose 已返回但宿主机仍无法访问 `13080`，检查端口映射与代理绕过设置。
- `CLI not found`：检查 `WECHAT_CLI_PATH`，部分安装目录名称可能不同。
- `automation enabled`：开发者工具未打开自动化/服务端口权限。
- `Port 9420 is in use`：换一个 `MINIAPP_AUTOMATION_PORT`。
- `Missing Mini Program element`：页面未编译成功，或稳定 `data-testid` 被误删。

普通 Linux CI 只运行 `pnpm verify:l49:static`、纯函数测试和已有业务门禁；带 Docker Desktop 与微信开发者工具的 Mac 或后续自托管 Mac Runner 执行完整主命令。
