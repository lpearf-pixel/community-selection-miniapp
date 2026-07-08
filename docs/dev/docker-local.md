# Docker 本地开发环境

本项目的 Docker 本地开发环境用于在 Linux 容器内启动 API、Admin 和 PostgreSQL，避免宿主机依赖污染容器运行时。

## 推荐重置启动流程

当遇到依赖安装、native binary 或 pnpm store 异常时，日常优先只清理容器内 `node_modules` / `pnpm-store` named volumes，然后重新构建：

```bash
docker compose down --remove-orphans

docker volume ls --format '{{.Name}}' | grep -E 'node-modules|pnpm-store'

docker volume ls --format '{{.Name}}' | grep -E 'node-modules|pnpm-store' | xargs -r docker volume rm

docker compose up --build --force-recreate
```

不要在容器启动命令里执行 `pnpm store prune`。API 和 Admin 容器会并行启动并执行 `pnpm install`，如果其中一个容器在另一个容器安装依赖时 prune store，named volume 中可能出现缺文件，进而触发 `ERR_PNPM_ENOENT`。

如果看到类似错误：

```text
ERR_PNPM_ENOENT ENOENT: no such file or directory, open '/root/.local/share/pnpm/store/v3/files/...'
```

请使用上面的恢复命令，只删除名称匹配 `node-modules` 或 `pnpm-store` 的 volumes。日常不要执行 `docker compose down -v`，因为 `down -v` 会同时删除 `postgres-data`，导致本地 PostgreSQL 数据被清空。只有明确需要连数据库也一起重置时，才使用 `docker compose down -v`。

如还需要清理宿主机依赖缓存，可额外删除本地依赖目录，但这不是恢复 `ERR_PNPM_ENOENT` 的首选步骤：

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -rf .pnpm-store
```

## 为什么固定 npm registry

Docker 容器内统一固定使用 `https://registry.npmjs.org/` 拉取依赖，不使用 `registry.yarnpkg.com`。

这样可以避免 registry 镜像 tarball 与 lockfile integrity 不一致导致的 pnpm retry，例如历史上出现过的 `ERR_PNPM_TARBALL_INTEGRITY` 和 `c12@3.1.0` 下载校验失败问题。

本修复不修改 lockfile，不升级依赖，只稳定 Docker 本地开发环境的安装来源。

## 为什么设置 verify-store-integrity=false

`verify-store-integrity=false` 仅用于本地 Docker 开发环境。

它用于避免旧 pnpm store、registry 切换或缓存残留造成 integrity retry 卡住。容器启动命令仍会执行 `pnpm install --force`，以便重新安装当前 Linux 容器平台需要的依赖；该设置不修改 `pnpm-lock.yaml`，也不升级依赖。

## 为什么使用 named volumes

API 和 Admin 服务使用 named volumes 隔离容器内 `node_modules` 与 pnpm store：

- `api-node-modules`
- `api-pnpm-store`
- `admin-node-modules`
- `admin-pnpm-store`

这样可以避免 macOS 宿主机的 `darwin-arm64` native 包污染 Linux 容器。`esbuild`、`rollup`、Prisma 都依赖平台相关 native binary，因此容器内必须安装 Linux 平台依赖。

## 常见错误

如果没有清理旧依赖或没有使用当前 Docker 配置，可能会看到以下错误：

- `ERR_PNPM_TARBALL_INTEGRITY`，例如 `c12-3.1.0.tgz` integrity retry。
- `@esbuild/darwin-arm64` present but needs `@esbuild/linux-arm64`。
- `Cannot find module @rollup/rollup-linux-arm64-gnu`。
- Prisma cannot detect OpenSSL。

遇到以上问题时，优先执行本文的“推荐重置启动流程”。

## 为什么启动前要构建 workspace 依赖包

`@community-selection/shared` 和 `@community-selection/config` 的 package exports 指向各自的 `dist` 产物。Docker dev 容器挂载仓库源码后，如果直接启动 API 或 Admin，运行时可能读取不存在或过期的 `dist` 文件，而不是最新的 `src`。

因此 Docker 启动命令会在 `pnpm db:generate` 和 dev server 启动前先执行：

```bash
pnpm --filter @community-selection/shared build
pnpm --filter @community-selection/config build
```

如果跳过这一步，API 可能出现类似 `The requested module '@community-selection/shared' does not provide an export named 'fail'` 的错误。这通常表示 `packages/shared/src/index.ts` 已经导出目标符号，但 `dist/index.js` 仍是旧产物。

## tsx import 返回空对象时如何排查

如果在 `tsx` 下执行 `import('@community-selection/shared')` 或 `import * as m from '@community-selection/shared'` 返回空对象 `[]`，需要检查 `tsconfig.base.json` 的 `paths` 配置。

运行时 import 不能指向 `dist/index.d.ts`。`.d.ts` 只包含类型声明，没有运行时 JS export；如果 `tsx` 把运行时 import 解析到声明文件，就会看到空模块，并可能再次触发 `The requested module '@community-selection/shared' does not provide an export named 'fail'`。

本地 Docker 配置应让 `@community-selection/shared` 和 `@community-selection/config` 指向 `dist/index.js`，或者直接依赖 package exports；不要把运行时路径映射到 `dist/index.d.ts`。


## Docker API E2E 验证

Docker API 启动后，可以执行以下命令通过 HTTP 验证本地 MVP 主链路：

```bash
pnpm exec tsx scripts/verify-docker-api-e2e-local.ts
```

该脚本默认请求 `http://127.0.0.1:13080`，也可以通过 `API_BASE_URL` 环境变量覆盖。

## Docker API E2E public response audit

Run the Docker API E2E security audit after the API container is up:

```bash
API_BASE_URL=http://127.0.0.1:13080 pnpm exec tsx scripts/verify-docker-api-e2e-local.ts --debug
```

The script records all public API responses it touches and audits them at the end of the run. Public responses must not expose raw `receiver_phone`, full receiver phone values such as `13812345678`, internal cost fields such as `cost_price_cents`, service reward configuration such as `commission_value` / `commission_type`, or inventory internals such as `stock_deduct_quantity`.

If the E2E audit reports risk findings, do not relax the test. Fix the backend response mapper for the reported endpoint so public APIs only return safe fields such as `receiver_phone_masked`, public `price_cents`, `sale_unit`, `sale_spec_name`, `pay_amount_cents`, `total_amount_cents`, `requested_refund_cents`, and `approved_refund_cents`.

## 容器内发布 stage report 到 GitHub

Docker 本地开发容器会在启动时安装本地开发和报告发布需要的工具：

- `git`
- `openssh-client`
- `ca-certificates`
- `curl`
- `bash`

这些工具只用于本地 Docker 开发/验证/报告发布环境；不要把该配置理解为生产镜像要求。

如果需要在容器内执行 `report:publish` 并推送 `stage-reports`，需要用户自行临时提供 GitHub Fine-grained token。不要提交 token，不要把 token 写入 `docker-compose.yml`，也不要把 token 写入仓库中的任何文件。

### 1. 创建 GitHub Fine-grained token

在 GitHub 创建 Fine-grained token，并限定：

- Repository: `lpearf-pixel/community-selection-miniapp`
- Contents: Read and write
- Metadata: Read

如果后续遇到 `403 Write access not granted`，请重新生成 token，并确认 `Contents: Read and write` 已启用。

### 2. 容器内临时配置 token

```bash
docker compose exec -e GITHUB_TOKEN="<token>" api sh -lc '
cd /app &&
git config --global user.name "lpearf-pixel" &&
git config --global user.email "lpearf-pixel@users.noreply.github.com" &&
git config --global --add safe.directory /app &&
git remote set-url origin https://github.com/lpearf-pixel/community-selection-miniapp.git &&
git config --global credential.helper store &&
printf "https://x-access-token:%s@github.com\n" "$GITHUB_TOKEN" > ~/.git-credentials &&
git ls-remote origin stage-reports
'
```

说明：

- `GITHUB_TOKEN` 只通过 `docker compose exec -e` 临时注入本地容器。
- `credential.helper` 只用于本地容器临时发布。
- `~/.git-credentials` 只存在于容器用户目录，不要复制或提交到仓库。
- `git ls-remote origin stage-reports` 用于确认 token 至少可以访问远端分支。

### 3. 生成并发布报告

先生成 L24 报告：

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm report:stage -- --stage=L24
"
```

如果 token 权限确认可用，再执行发布：

```bash
docker compose exec api sh -lc "
cd /app &&
pnpm report:publish -- --stage=L24 --skip-source-sync-check --push
"
```

没有 GitHub token 或 token 权限不足时，`report:publish --push` 可能会在 GitHub 权限阶段失败；这属于凭据问题。当前 Docker 容器应已包含 `git`，不应再出现 `spawnSync git ENOENT`。

### 4. 发布后清理 token

```bash
docker compose exec api sh -lc "
rm -f ~/.git-credentials &&
git config --global --unset credential.helper || true
"
```

再次强调：不要提交 token，不要把 token 写入 `docker-compose.yml`，token 只用于本地容器临时发布。
