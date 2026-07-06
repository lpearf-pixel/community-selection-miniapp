# Docker 本地开发环境

本项目的 Docker 本地开发环境用于在 Linux 容器内启动 API、Admin 和 PostgreSQL，避免宿主机依赖污染容器运行时。

## 推荐重置启动流程

当遇到依赖安装、native binary 或 pnpm store 异常时，建议先清理本地与容器卷后重新构建：

```bash
docker compose down -v
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -rf .pnpm-store
docker compose up --build
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
