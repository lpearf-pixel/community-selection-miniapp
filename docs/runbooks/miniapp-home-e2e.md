# 春华秋实首页点击冒烟测试

该测试由两部分组成：PostgreSQL 与 API 使用 Docker Compose 容器启动；微信开发者工具和点击驱动运行在 Mac 宿主机。测试会点击首页“全部商品、今日开团、我的订单”三个稳定业务入口并验证目标页面路径，不会调用真实支付、分享、登录或退款。

## 首次准备

1. 在 Mac 安装并启动 Docker Desktop，确认 `docker compose version` 可执行。
2. 安装并登录微信开发者工具；不要使用截图中显示的“游客模式”。在“设置 → 安全设置”中开启服务端口，并为本地开发关闭合法域名校验。
3. 在微信公众平台取得该小程序的真实 AppID（`wx` 开头共 18 位），从仓库根目录生成仅供本机使用的项目配置：

   ```bash
   MINIAPP_APP_ID="wx你的16位标识" pnpm setup:miniapp:project
   ```

   生成的 `apps/miniapp/project.config.json` 已被 Git 忽略；仓库只保留不含真实 AppID 的 `project.config.example.json`。
4. 从仓库根目录执行 `pnpm setup:miniapp:e2e`。该命令只安装点击框架自己的依赖，不修改根 `pnpm-lock.yaml`。
5. 确认宿主机端口 `13080` 和 `15432` 未被其他程序占用。

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

1. 在启动 Docker 和微信开发者工具前校验 `project.config.json` 已配置真实 AppID；缺失、占位值和 `touristappid` 会立即失败。
2. `docker compose up -d --wait postgres api`，不会启动后台管理端。
3. 再从 Mac 宿主机检查 `http://127.0.0.1:13080/api/health`。
4. 临时把开发者工具内的 `API_BASE_URL` 指向容器映射地址，确认首页商品与团购请求均完成且无页面级错误。
5. 执行首页点击冒烟，并在结束时恢复原有 `API_BASE_URL` 存储值。
6. 测试结束后保留 PostgreSQL/API 容器，便于继续开发和复测。

容器已经健康时，可只跑页面点击；该命令默认仍指向 `http://127.0.0.1:13080`，并在测试后恢复此前设置：

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
- `MINIAPP_E2E_API_BASE_URL`：开发者工具内临时使用的 API 基址；主命令默认从健康地址解析 origin，单独点击命令默认 `http://127.0.0.1:13080`。
- `MINIAPP_AUTOMATION_TIMEOUT_MS`：等待微信开发者工具自动化端口的最长毫秒数，默认 `60000`；脚本按端口状态轮询，不依赖固定睡眠。

## 失败证据

默认写入：

```text
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.log
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.png
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>-compose.log
/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>-devtools.log
```

小程序日志包含当前页面路径、页面数据的字段/数组长度摘要、控制台事件、未捕获异常和调用栈，不记录完整订单或用户字段。容器失败或点击失败时，Compose 诊断文件包含 `docker compose ps` 以及 PostgreSQL/API 最后 200 行日志；DevTools 诊断文件保留微信 CLI 的标准输出和错误。可通过 `MINIAPP_E2E_OUTPUT_DIR` 改变输出目录。

常见失败：

- `requires macOS`：真实微信开发者工具测试不能在普通 Linux CI 运行。
- `Unable to run Docker`：Docker Desktop 尚未启动，或 `docker` 不在 PATH 中。
- `Docker exited with status`：查看输出的 `-compose.log`，重点检查端口占用、依赖安装与数据库迁移。
- `API health check timed out`：Compose 已返回但宿主机仍无法访问 `13080`，检查端口映射与代理绕过设置。
- `Home API request failed`：宿主机健康检查已通过，但开发者工具内的商品或团购请求失败；检查“不校验合法域名”、代理绕过和小程序控制台。
- `CLI not found`：检查 `WECHAT_CLI_PATH`，部分安装目录名称可能不同。
- `服务端口`：登录微信开发者工具，在“设置 → 安全设置”中开启服务端口；开启后关闭当前普通项目窗口，再重新运行命令。
- `project.config.json`：先用 `MINIAPP_APP_ID="wx..." pnpm setup:miniapp:project` 生成本机配置。
- `游客模式` 或 `webapi_getwxaasyncsecinfo:fail`：项目没有绑定可用的真实 AppID，或开发者工具尚未登录。重新生成本机项目配置并登录后再运行；游客模式不能作为本项目的 E2E 准入环境。
- `automation endpoint`：查看对应的 `-devtools.log`；若端口仍未建立，确认没有普通窗口占用同一项目，并关闭该窗口后重试。
- `Port 9420 is in use`：换一个 `MINIAPP_AUTOMATION_PORT`。
- `Missing Mini Program element`：页面未编译成功，或稳定 `data-testid` 被误删。

普通 Linux CI 只运行 `pnpm verify:l49:static`、纯函数测试和已有业务门禁；带 Docker Desktop 与微信开发者工具的 Mac 或后续自托管 Mac Runner 执行完整主命令。

## 全局主题与 19 页验收

首页点击冒烟通过后，使用 `pnpm e2e:miniapp:theme` 验证全部 19 个小程序页面。完整换肤流程、证据目录和验收标准见 [小程序全局主题切换与 19 页验收](miniapp-theme-switch.md)。
