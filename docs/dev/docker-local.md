# Docker 本地开发环境

## 启动方式

```bash
docker compose down -v
docker compose up --build
```

## 访问地址

- API: http://127.0.0.1:13080
- Admin: http://127.0.0.1:13081
- Postgres: 127.0.0.1:15432

## 为什么隔离 node_modules

本地开发机可能是 macOS `darwin-arm64`，Docker 容器通常是 `linux-arm64` 或 `linux-amd64`。`esbuild`、`rollup`、Prisma 都依赖 native binary，如果把宿主机 `node_modules` 直接挂进容器，就可能让 Linux 容器读取 macOS 平台依赖并启动失败。

`docker-compose.yml` 使用 named volume 挂载 `/app/node_modules` 和 pnpm store，让容器在 Linux 环境内安装并复用自己的依赖，避免宿主机依赖污染容器。

## 常见错误

- `@esbuild/darwin-arm64 present but needs @esbuild/linux-arm64`
- `Cannot find module @rollup/rollup-linux-arm64-gnu`
- Prisma cannot detect OpenSSL

## 解决方式

```bash
docker compose down -v
```

如需彻底清理宿主机依赖，可选执行：

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
```

然后重新启动：

```bash
docker compose up --build
```
