# 自建 GitHub Actions Runner 环境契约与排障

本文记录 `community-selection-miniapp` 在自建 GitHub Actions Runner 上运行质量门禁与 Admin E2E 的环境契约、验证顺序、常见故障和清理规则。

范围限制：本文只描述 Runner 使用方需要遵守的契约，不要求修改业务代码、CI workflow、Runner 权限、Docker socket 权限或宿主机配置。任何 token、注册码、Cookie、私有 URL、数据库真实密码和生产密钥都不得写入本文或提交到仓库。

## 0. 已确认与待确认

### 已从仓库确认

- 当前有效工程内容位于 `stable/l49-business-base` 分支。
- 根 `package.json` 声明 `packageManager: pnpm@9.15.4`，Node engine 为 `^20.19.0 || >=22.12.0`。
- 根脚本包含 `db:generate`、`lint`、`typecheck`、`test`、`build`、`setup:admin:e2e` 和 `e2e:admin`。
- Admin E2E 子项目使用 Playwright `1.61.1`。
- `docker-compose.yml` 暴露 PostgreSQL `15432`、API `13080`、Admin `13081`。
- Admin E2E 的 `run.cjs` 只用 Docker Compose 启动 PostgreSQL；API 与 Admin 由 Runner 工作目录内的原生 Node/pnpm 子进程启动。
- 容器 Runner 内执行浏览器 smoke 时，`run.cjs` 使用与 Playwright 版本匹配的官方 Playwright 镜像，并通过 `docker cp` 传入测试文件。
- 容器 Runner 内数据库主机默认使用 `host.docker.internal`；物理机 Runner 默认使用 `127.0.0.1`；两者可通过 `ADMIN_E2E_DB_HOST` 或 `ADMIN_E2E_DATABASE_URL` 覆盖。
- local runner manager 的 Compose 将 `/var/run/docker.sock` 挂入 Runner 容器，并把 `_work` 放在命名卷中。
- local runner manager 的 Runner 镜像固定 Docker CLI `20.10.24` 与 Docker Compose plugin `2.3.3`。

### 已从运行日志或排障过程确认

- 当前 `home-community-runner` 日志中曾显示 GitHub Runner 版本为 `2.336.0`。
- 当前宿主 Docker Desktop daemon 曾确认可用，Server Version 为 `20.10.13`。
- 曾出现 Docker Desktop 崩溃、Docker socket 诊断误判、Runner 容器内 Docker CLI 与宿主 daemon 版本不兼容、重复注册 Runner、容器路径误传给宿主 Docker bind mount、Playwright/Chromium 依赖缺失等问题。

### 待确认

- 每次重建 Runner 镜像后的 GitHub Runner 实际版本；local runner manager 的 Dockerfile 未固定 `RUNNER_VERSION` 时会在构建期取最新 release。
- 当前宿主机 CPU、内存、Docker Desktop 版本和 Docker context。
- 每个新增实例的最终 `RUNNER_NAME`、`RUNNER_LABELS` 与 GitHub Actions 页面显示是否一致。
- 物理机 Runner 迁移后的 Chromium 系统依赖是否完整。

## 一、Runner 拓扑

### 1.1 当前容器 Runner 拓扑

```text
GitHub Actions job
  -> home-community-runner 容器中的 GitHub Actions runner
  -> GitHub Actions workspace，例如 $GITHUB_WORKSPACE
  -> 容器内 docker CLI
  -> /var/run/docker.sock bind mount
  -> 宿主机 Docker Desktop / Docker Engine daemon
  -> 宿主 Docker daemon 创建 PostgreSQL 容器和 Playwright 浏览器容器
```

关键边界：

- `home-community-runner` 是 Linux 容器 Runner；即使宿主机是 macOS，GitHub Actions 看到的仍是 Linux self-hosted runner。
- Runner 容器的 `$GITHUB_WORKSPACE` 是容器内路径，不是宿主机路径。
- 宿主 Docker daemon 通过 bind-mounted socket 接收命令，但它解析 bind mount 源路径时使用宿主文件系统视角。
- 因此，不能把 Runner 容器内路径直接作为宿主 Docker bind mount 源路径；否则可能触发 `mounts denied`、路径不存在或挂载空目录。
- Admin E2E 已避免此问题：容器 Runner 路径不作为 bind mount 源，浏览器测试文件通过 `docker cp` 传入 Playwright 容器。

### 1.2 runnerctl 能看到什么

`runnerctl` 或 Runner 容器日志通常只能看到：

- Runner 是否启动；
- 是否已连接 GitHub；
- 是否领取 job；
- job 完成或失败；
- Runner 容器级启动错误。

具体 GitHub Actions step 日志不在 `runnerctl` 的视野里。排查具体 step 时应使用：

```bash
gh run watch <run-id>
gh run view <run-id> --log
```

或在 GitHub Actions 页面查看对应 run/job/step 日志。

### 1.3 容器 Runner 与物理机 Runner 差异

| 项目 | 当前容器 Runner | 未来物理机 Runner |
| --- | --- | --- |
| Runner 运行位置 | `home-community-runner` Linux 容器 | Linux/macOS 主机原生 runner 进程 |
| Docker 使用方式 | 容器内 docker CLI 通过 `/var/run/docker.sock` 访问宿主 daemon | 物理机本地 docker CLI 直接访问本机 daemon |
| PostgreSQL 地址 | 默认 `host.docker.internal:15432` | 默认 `127.0.0.1:15432` |
| Chromium | 使用 Playwright 官方容器镜像执行 browser smoke | 使用物理机安装的 Playwright Chromium 与系统依赖 |
| 路径语义 | Runner workspace 是容器内路径，不能直接作为宿主 bind mount 源 | workspace 是物理机真实路径，可作为本机 Docker bind mount 源，但仍需谨慎 |
| 需要重点验证 | Docker socket、CLI/daemon 兼容、host.docker.internal、docker cp | 系统依赖、工作目录权限、端口占用、本地浏览器安装 |

## 二、环境契约

### 2.1 版本契约

| 组件 | 契约 / 当前确认 | 说明 |
| --- | --- | --- |
| GitHub Runner | 已见日志：`2.336.0`；重建后待确认 | Dockerfile 未固定 `RUNNER_VERSION` 时构建期取最新 release |
| Node.js | 标准使用 `20.19.0` | `package.json` engine 允许 `^20.19.0 || >=22.12.0`；当前门禁按 Node 20.19.x 记录 |
| pnpm | `9.15.4` | 根 `package.json` 与 Admin E2E 子项目均声明 `pnpm@9.15.4` |
| Docker CLI in runner image | `20.10.24` | local runner manager 已固定，避免新 CLI 连接旧 Docker Desktop daemon 出现 400 |
| Docker daemon | 已见宿主 Server `20.10.13`；当前环境运行前再确认 | 以 `docker version` / `docker info` 为准 |
| Docker Compose | Runner 镜像 plugin `2.3.3` | 由 local runner manager Dockerfile 固定 |
| Playwright | `1.61.1` | `scripts/admin-e2e/package.json` 固定 |
| PostgreSQL | `postgres:16` | `docker-compose.yml` 中 postgres service 使用 |

### 2.2 self-hosted 标签策略

推荐标签分两类：

```text
共享标签：community
实例标签：community-w01、community-w02 等
```

常规 workflow 使用共享标签：

```yaml
runs-on: [self-hosted, Linux, community]
```

单实例排障时才使用实例标签：

```yaml
runs-on: [self-hosted, Linux, community-w01]
```

规则：

- 一个 runner 进程同一时间只能执行一个 GitHub Actions job。
- 并发执行多个 job 需要多个 `instances/*.env`，每个实例必须有唯一 `RUNNER_NAME`。
- 同一仓库的多个实例应保留相同共享标签，例如 `community`，否则 workflow 可能无法调度到新增实例。
- `GITHUB_REPOSITORY` 决定该 Runner 注册到哪个仓库；仓库级 Runner 不会自动服务其他仓库。

### 2.3 必需端口

| 端口 | 用途 | 来源 |
| --- | --- | --- |
| `15432` | PostgreSQL，宿主端口映射到容器 `5432` | `docker-compose.yml` |
| `13080` | API 服务健康检查与 `/api/*` | `docker-compose.yml` 与 `run.cjs` |
| `13081` | Admin Vite dev server | `docker-compose.yml` 与 `run.cjs` |

运行 Admin E2E 前，这些端口不能被其他本地服务占用。

### 2.4 环境变量

不要在文档、README、日志摘要或提交中写入秘密值。下表只记录用途。

| 变量 | 位置 | 用途 | 是否秘密 |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | Runner manager `.env` | 注册/移除 repository-scoped self-hosted runner | 是 |
| `GITHUB_REPOSITORY` | Runner instance `.env` | 指定 Runner 注册到的仓库 | 否 |
| `RUNNER_NAME` | Runner instance `.env` | GitHub Actions 页面显示的 Runner 名，必须唯一 | 否 |
| `RUNNER_LABELS` | Runner instance `.env` | workflow `runs-on` 匹配标签 | 否 |
| `RUNNER_GROUP` | Runner instance `.env` | GitHub runner group | 否 |
| `RUNNER_WORKDIR` | Runner instance `.env` | Runner 工作目录名 | 否 |
| `RUNNER_EPHEMERAL` | Runner instance `.env` | 是否注册 ephemeral runner | 否 |
| `HTTP_PROXY` / `HTTPS_PROXY` | Runner manager `.env` | 代理 GitHub、npm、镜像仓库等出站访问 | 可能敏感 |
| `ADMIN_E2E_DB_HOST` | Admin E2E | 覆盖数据库主机；容器 Runner 通常为 `host.docker.internal`，物理机为 `127.0.0.1` | 否 |
| `ADMIN_E2E_DATABASE_URL` | Admin E2E | 完整覆盖 E2E 数据库连接串 | 可能敏感 |
| `ADMIN_E2E_PLAYWRIGHT_IMAGE` | Admin E2E | 覆盖 Playwright 浏览器容器镜像 | 否 |
| `DATABASE_URL` | API / Prisma | API 与 Prisma 访问数据库 | 可能敏感 |
| `ADMIN_AUTH_ENABLED` | API | E2E 中开启后台登录认证 | 否 |
| `ADMIN_AUTH_MODE` | API | E2E 中使用 session 模式 | 否 |
| `ADMIN_TOKEN` | API | 非生产测试 token；不要复用到生产 | 是 |
| `ADMIN_TOTP_ENCRYPTION_KEY` | API | 非生产测试 TOTP 加密 key；不要复用到生产 | 是 |
| `PORT` | API | API 监听端口，E2E 使用 `13080` | 否 |
| `VITE_API_BASE_URL` | Admin | E2E 中保持同源 `/api` 代理；不要改成跨域 API 地址 | 否 |

### 2.5 数据库地址覆盖规则

`run.cjs` 的数据库主机选择逻辑：

```text
ADMIN_E2E_DATABASE_URL 存在 -> 直接使用完整连接串
否则 ADMIN_E2E_DB_HOST 存在 -> 使用该主机拼接 E2E 连接串
否则在容器 Runner 中 -> host.docker.internal
否则在物理机 Runner 中 -> 127.0.0.1
```

建议：

```bash
# 容器 Runner
ADMIN_E2E_DB_HOST=host.docker.internal

# 物理机 Runner
ADMIN_E2E_DB_HOST=127.0.0.1
```

只有在需要自定义用户名、密码、数据库名或端口时，才使用 `ADMIN_E2E_DATABASE_URL` 完整覆盖。

## 三、标准验证顺序

必须按顺序执行。前一步失败时先排障，不要跳过。

| 顺序 | 命令 | 适用位置 | 预期结果 |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | Runner workspace / 物理机 workspace | 依赖安装完成，lockfile 未变化，退出码 0 |
| 2 | `pnpm db:generate` | Runner workspace / 物理机 workspace | Prisma Client 生成成功，退出码 0 |
| 3 | `pnpm lint` | Runner workspace / 物理机 workspace | lint placeholder 测试和扫描通过，退出码 0 |
| 4 | `pnpm typecheck` | Runner workspace / 物理机 workspace | shared/config build 与全仓 typecheck 通过，退出码 0 |
| 5 | `pnpm test` | Runner workspace / 物理机 workspace | admin-e2e contract 与全仓测试通过，退出码 0 |
| 6 | `pnpm build` | Runner workspace / 物理机 workspace | shared/config/api/admin build 通过，退出码 0 |
| 7 | `node --import tsx --test scripts/admin-e2e/admin-auth-runtime.test.ts` | Runner workspace / 物理机 workspace | bcrypt hash/verify 在 Node ESM loader 路径下通过 |
| 8 | `node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs` | Runner workspace / 物理机 workspace | E2E contract 与清理故障注入测试通过 |
| 9 | `pnpm setup:admin:e2e` | Runner workspace / 物理机 workspace | `scripts/admin-e2e` 子项目依赖按 lockfile 安装完成 |
| 10 | `pnpm --dir scripts/admin-e2e exec playwright install chromium` | 物理机 Runner；容器 Runner 通常由官方 Playwright 镜像提供浏览器 | Chromium 安装成功；容器 Runner 不应使用 `--with-deps` 要求 root 密码 |
| 11 | `pnpm e2e:admin` | Runner workspace / 物理机 workspace | PostgreSQL、fixture、API、Admin、browser smoke 全流程通过并完成清理 |

补充：若 workflow 使用 `actions/setup-node` 的 pnpm cache，必须先安装 pnpm，再启用 pnpm cache 或执行依赖安装；否则 setup-node 找不到 pnpm。

## 四、本次实际遇到的问题

| 现象 | 根因 | 正确处理 | 不应采取的处理 |
| --- | --- | --- | --- |
| `actions/setup-node` 启用 pnpm cache 时失败，提示 pnpm 尚未安装 | workflow 在 pnpm 可用前启用了 pnpm cache | 先安装/启用 pnpm，再启用 cache 或安装依赖 | 把问题归因于业务代码或删除 lockfile |
| 安装依赖后 Prisma 相关代码运行失败 | 依赖安装不等于 Prisma Client 已生成 | 在依赖安装后执行 `pnpm db:generate` | 手动改生成产物或跳过 Prisma 相关测试 |
| 历史测试硬编码旧字段名或旧源码位置 | 测试断言绑定实现细节，领域实现已演进 | 更新测试契约到当前字段和语义 | 回滚业务代码来迎合旧测试 |
| `playwright install --with-deps` 在容器中失败 | Runner 容器无 root 密码或不应临时提升权限安装系统包 | 容器 Runner 使用匹配版本的官方 Playwright 镜像；物理机预装系统依赖 | 长期使用 root 跑 Runner，或在 CI 中要求人工输入 sudo 密码 |
| Docker socket 诊断显示权限问题或 400 | 可能是 socket 权限、Docker Desktop 崩溃、CLI/daemon 版本不兼容等不同层问题 | 先区分 raw Docker API `/_ping`、docker CLI、daemon 版本和 socket 权限 | 默认建议 `chmod` Docker socket，或长期把 Runner 改成 root |
| Runner 容器路径传给宿主 Docker bind mount 后 `mounts denied` | 宿主 daemon 解析 bind mount 源路径，不能识别容器内 workspace 路径 | 不用容器内路径做宿主 bind mount；使用 `docker cp` 或宿主真实路径 | 扩大 Docker Desktop 文件共享范围来掩盖路径语义错误 |
| Runner 容器缺少 Chromium 系统库 | 基础 Runner 镜像不是 Playwright 浏览器镜像 | 容器 Runner 用 `mcr.microsoft.com/playwright:v<version>-noble` 执行浏览器 smoke | 在 Runner 容器内临时安装大量系统依赖且不固化 |
| API/Admin 都放进 Compose 后调试复杂 | 容器 Runner + 宿主 Docker + bind mount 路径边界复杂 | API/Admin 在 Runner 原生启动，Docker 只负责隔离 PostgreSQL | 把所有服务都强行放入 Compose 并继续挂载容器路径 |
| 容器 Runner 执行浏览器 smoke 时找不到测试文件 | 浏览器容器与 Runner 容器文件系统不同 | 使用官方 Playwright 镜像，并通过 `docker cp` 传入 `node_modules`、测试文件和 fixture | 假设两个容器共享同一个 workspace |
| `bcrypt.hash is not a function` | `bcryptjs` CommonJS/ESM 导入互操作在 Node ESM/tsx 路径下暴露 | 使用经过 runtime test 覆盖的导入方式，并保留 `admin-auth-runtime.test.ts` | 只跑 TypeScript 类型检查就认为运行时导入正确 |
| Session Cookie 或 OPTIONS/CORS 异常 | Vite 指向跨域 API 地址，导致 Cookie 同源语义和预检复杂化 | Admin 使用同源 `/api` 代理到 `http://localhost:13080` | 在 E2E 中把 `VITE_API_BASE_URL` 改成跨域 URL |
| Ant Design 中文按钮按角色查找失败 | 可访问名称可能包含字符间空格 | locator 使用可容忍空格的正则，例如 `/登\s*录/`、`/刷\s*新/` | 用纯文本精确匹配所有中文按钮 |
| Playwright strict locator 冲突 | 页面存在重复导航名称或多个同名按钮 | 先限定 `AdminShell` 范围，再查找按钮 | 放宽 strict mode 或使用不稳定下标 |
| Compose 或 fixture 部分创建失败后残留资源 | 清理标志设置过晚，失败路径不知道哪些资源已创建 | 在尝试创建前设置 `databaseStartAttempted`、`fixtureSetupAttempted`、`browserContainerCreateAttempted` | 只依赖最后的 happy-path cleanup |
| Actions 取消或超时时资源残留 | `SIGINT` / `SIGTERM` 可能绕过普通 `finally` 的完整路径 | 注册 signal handler，收到信号时执行 cleanup 后按 130/143 退出 | 只写 `finally`，不处理信号 |
| Actions 日志出现 Node 运行时弃用警告 | GitHub Action 自身运行时与项目 Node 版本不是同一概念 | 区分 action runtime warning 与项目 `node -v` / `package.json` engine | 因 action warning 直接改项目 Node 版本 |

## 五、清理与恢复

### 5.1 `scripts/admin-e2e/run.cjs` 清理顺序

`run.cjs` 的清理顺序为：

1. 浏览器容器：`docker rm -f <精确浏览器容器名>`。
2. API/Admin 子进程：对进程组发送 `SIGTERM`。
3. 一次性管理员和 fixture 文件：`pnpm exec tsx scripts/admin-e2e/fixture.ts cleanup`。
4. PostgreSQL 容器、卷和网络：`docker compose -p <精确项目名> -f docker-compose.yml down --volumes --remove-orphans`。

覆盖场景：

- 正常成功：`finally` 执行 cleanup。
- 普通命令失败：抛错后进入 `finally` 执行 cleanup。
- `SIGINT`：signal handler 执行 cleanup，退出码按 130。
- `SIGTERM`：signal handler 执行 cleanup，退出码按 143。

### 5.2 人工排查的只读命令

禁止提供或执行 `docker system prune`、广泛 `rm -rf`、清空整个 Docker volume 目录等破坏性命令。人工清理时必须使用精确项目名、容器名、卷名或网络名。

只读检查残留容器：

```bash
docker ps -a --filter 'name=community-selection-admin-e2e' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

只读检查残留卷：

```bash
docker volume ls --filter 'name=community-selection-admin-e2e'
docker volume ls --filter 'name=postgres-data'
```

只读检查残留网络：

```bash
docker network ls --filter 'name=community-selection-admin-e2e'
```

只读检查端口占用，macOS / Linux 通用优先：

```bash
lsof -nP -iTCP:15432 -sTCP:LISTEN || true
lsof -nP -iTCP:13080 -sTCP:LISTEN || true
lsof -nP -iTCP:13081 -sTCP:LISTEN || true
```

Linux 物理机也可用：

```bash
ss -ltnp '( sport = :15432 or sport = :13080 or sport = :13081 )' || true
```

只读检查 Compose 状态：

```bash
docker compose -p community-selection-admin-e2e-<run-id-or-pid> -f docker-compose.yml ps
```

只读查看 Compose 日志：

```bash
docker compose -p community-selection-admin-e2e-<run-id-or-pid> -f docker-compose.yml logs --tail=100
```

## 六、物理机迁移清单

### 6.1 Linux 物理机 Runner

需要准备：

- 注册 repository-scoped self-hosted runner，并设置共享标签 `community` 和可选实例标签。
- Node `20.19.x`、pnpm `9.15.4`。
- Docker Engine 与 Docker Compose plugin。
- Playwright `1.61.1` 对应的 Chromium 与系统依赖。
- PostgreSQL 通过 Docker Compose 暴露到 `127.0.0.1:15432`。
- 工作目录对 runner 用户可读写。
- 出站 HTTPS 可访问 GitHub、npm registry、容器镜像仓库。

现有脚本无需修改的部分：

- `pnpm setup:admin:e2e`。
- `pnpm e2e:admin`。
- `run.cjs` 的 PostgreSQL Compose 启动、API/Admin 原生启动和 fixture 清理流程。
- 物理机路径下的原生 Playwright 执行路径。

必须重新验证：

- `node -v`、`pnpm -v`。
- `docker version`、`docker compose version`。
- `pnpm --dir scripts/admin-e2e exec playwright install chromium`。
- `pnpm e2e:admin` 是否完整清理容器、卷、网络和一次性管理员。

### 6.2 macOS 物理机 Runner

需要准备：

- 注册 repository-scoped self-hosted runner，并设置共享标签 `community` 和可选实例标签。
- Node `20.19.x`、pnpm `9.15.4`。
- Docker Desktop 与 Docker Compose。
- Playwright `1.61.1` Chromium。
- PostgreSQL 通过 Docker Compose 暴露到 `127.0.0.1:15432`。
- runner 工作目录对 runner 用户可读写。
- Docker Desktop 文件共享只在确实需要 bind mount 宿主路径时配置；Admin E2E 当前不要求把 Runner 容器路径共享给宿主。

现有脚本无需修改的部分：

- `run.cjs` 在非容器环境会走物理机 Playwright 路径。
- `ADMIN_E2E_DB_HOST` 未设置时，非容器环境默认 `127.0.0.1`。
- API/Admin 仍由原生 pnpm 子进程启动。

必须重新验证：

- Docker Desktop daemon 是否稳定。
- `docker compose up -d --wait postgres` 是否支持当前 Compose 版本。
- 端口 `15432`、`13080`、`13081` 是否可用。
- Chromium 系统依赖是否满足真实 browser smoke。

## 七、常用诊断命令

| 命令 | 适用位置 | 用途 |
| --- | --- | --- |
| `docker version` | 宿主机、Runner 容器、物理机 | 区分 client/server 版本与 Docker daemon 可达性 |
| `docker compose ps` | 宿主机、Runner 容器、物理机 | 查看当前目录默认 Compose project 状态 |
| `docker compose logs --tail=100` | 宿主机、Runner 容器、物理机 | 查看当前目录默认 Compose project 近期日志 |
| `docker compose -p community-selection-admin-e2e-<id> -f docker-compose.yml ps` | 宿主机、Runner 容器、物理机 | 查看 Admin E2E 精确项目状态 |
| `docker compose -p community-selection-admin-e2e-<id> -f docker-compose.yml logs --tail=100` | 宿主机、Runner 容器、物理机 | 查看 Admin E2E 精确项目日志 |
| `bash ./runnerctl status community` | Runner manager 宿主机 | 查看 community Runner 实例、标签、状态 |
| `bash ./runnerctl logs community` | Runner manager 宿主机 | 查看 Runner 容器日志，只能看到领取/完成等 runner 层信息 |
| `docker logs --tail=100 home-community-runner` | Runner manager 宿主机 | 查看指定 Runner 容器日志 |
| `gh run watch <run-id>` | 任意已登录 gh 的终端 | 观察 GitHub Actions run 状态 |
| `gh run view <run-id> --log` | 任意已登录 gh 的终端 | 查看具体 job/step 日志 |
| `lsof -nP -iTCP:15432 -sTCP:LISTEN` | 宿主机、Runner 容器、物理机 | 检查 PostgreSQL 端口占用 |
| `lsof -nP -iTCP:13080 -sTCP:LISTEN` | 宿主机、Runner 容器、物理机 | 检查 API 端口占用 |
| `lsof -nP -iTCP:13081 -sTCP:LISTEN` | 宿主机、Runner 容器、物理机 | 检查 Admin 端口占用 |
| `node -v` | Runner 容器、物理机 | 确认项目 Node 版本，不要与 GitHub Action runtime warning 混淆 |
| `pnpm -v` | Runner 容器、物理机 | 确认 pnpm 版本为 `9.15.4` |

## 八、给新增 Runner 实例的使用规则

该契约适用于 `local-actions-runner-manager/instances` 下服务 `community-selection-miniapp` 的所有 Runner 实例。

新增实例时必须保持：

```dotenv
GITHUB_REPOSITORY=<本仓库 owner/name>
RUNNER_LABELS=lan,docker,home,community,<可选实例标签>
```

并确保：

- `RUNNER_NAME` 唯一。
- GitHub Actions workflow 使用共享标签 `community`，除非正在排查某个实例。
- 每个新实例启动后都执行 `runnerctl status` 和 `runnerctl doctor <instance>`。
- 不通过修改 Docker socket 权限、长期 root 运行或扩大宿主文件共享来规避脚本问题。

