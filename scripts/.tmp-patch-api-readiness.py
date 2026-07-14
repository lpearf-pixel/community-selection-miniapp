from pathlib import Path

branch_file = Path('scripts/verify-docker-api-e2e-local.ts')
source = branch_file.read_text()

source = source.replace(
    "const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:13080').replace(/\\/$/, '');",
    "const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://localhost:13080').replace(/\\/$/, '');"
)

needle = "function record(label: string, payload: unknown) {\n  auditCases.push({ label, payload });\n  if (debug) {\n    console.log(`\\n--- ${label} ---`);\n    console.log(JSON.stringify(payload, null, 2));\n  }\n}\n"
insert = """function record(label: string, payload: unknown) {
  auditCases.push({ label, payload });
  if (debug) {
    console.log(`\\n--- ${label} ---`);
    console.log(JSON.stringify(payload, null, 2));
  }
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) return `${error.name}: ${error.message}`;
  if (cause instanceof Error) return `${error.name}: ${error.message}; cause=${cause.name}: ${cause.message}`;
  if (typeof cause === 'object' && cause !== null) {
    const fields = cause as Record<string, unknown>;
    return `${error.name}: ${error.message}; cause=${JSON.stringify({ code: fields.code, errno: fields.errno, syscall: fields.syscall, address: fields.address, port: fields.port })}`;
  }
  return `${error.name}: ${error.message}; cause=${String(cause)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOrThrow(method: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  try {
    return await fetchWithTimeout(url, { ...init, method }, timeoutMs);
  } catch (error) {
    throw new Error(`${method} ${url} transport failed: ${errorDetails(error)}. Check docker compose ps and docker compose logs --tail=200 api.`);
  }
}

async function waitForApiReady(maxAttempts = 90, intervalMs = 1_000): Promise<void> {
  const path = '/api/health';
  let lastFailure = 'not attempted';
  console.log(`Docker API E2E target: ${API_BASE_URL}`);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOrThrow('GET', path, {}, 2_000);
      const body = await response.text();
      if (response.ok) {
        console.log(`Docker API ready after ${attempt} attempt(s).`);
        return;
      }
      lastFailure = `HTTP ${response.status}: ${body.slice(0, 300)}`;
    } catch (error) {
      lastFailure = errorDetails(error);
    }
    if (attempt === 1 || attempt % 10 === 0) {
      console.log(`Waiting for Docker API (${attempt}/${maxAttempts}): ${lastFailure}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Docker API did not become ready at ${API_BASE_URL}${path} after ${maxAttempts} attempts. Last failure: ${lastFailure}. Run docker compose ps and docker compose logs --tail=200 api.`);
}
"""
if needle not in source:
    raise SystemExit('record function block not found')
source = source.replace(needle, insert, 1)

old_request = """  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });"""
new_request = """  const response = await fetchOrThrow(method, path, {
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });"""
if source.count(old_request) != 2:
    raise SystemExit(f'expected two raw fetch request blocks, found {source.count(old_request)}')
source = source.replace(old_request, new_request)

main_needle = "async function main() {\n  await ensureDockerE2eFixtures(prisma);"
main_replace = "async function main() {\n  await waitForApiReady();\n  await ensureDockerE2eFixtures(prisma);"
if main_needle not in source:
    raise SystemExit('main readiness insertion point not found')
source = source.replace(main_needle, main_replace, 1)
branch_file.write_text(source)

verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
verifier_needle = "assert(existsSync('docs/dev/stage-verifier-compatibility.md'), 'global verifier compatibility guidance exists');"
verifier_replace = """assert(existsSync('docs/dev/stage-verifier-compatibility.md'), 'global verifier compatibility guidance exists');
for (const readinessMarker of ['waitForApiReady', "'/api/health'", 'fetchWithTimeout', 'fetchOrThrow', 'Docker API E2E target:', 'docker compose logs --tail=200 api']) {
  assert(e2e.includes(readinessMarker), `Docker E2E readiness/diagnostics must include ${readinessMarker}`);
}"""
if verifier_needle not in verifier:
    raise SystemExit('L45 verifier guidance assertion not found')
verifier = verifier.replace(verifier_needle, verifier_replace, 1)
verifier_path.write_text(verifier)

compat_path = Path('docs/dev/stage-verifier-compatibility.md')
compat = compat_path.read_text()
compat_append = """

## 6. Docker API 就绪与网络诊断

- `docker compose exec api ...` 只说明容器可执行命令，不代表 API 端口已经监听。
- 仓库源码以 bind mount 挂载，`git switch`、`git reset` 和批量文件更新会触发 `tsx watch` 重启；Docker E2E 必须先轮询 `/api/health`，不得立即发起业务请求。
- E2E 默认地址应与 Docker healthcheck 保持一致，并允许通过 `API_BASE_URL` 显式覆盖。
- 所有 HTTP transport 错误必须输出 method、完整 URL、超时信息以及底层 cause（如 `ECONNREFUSED`、`ENOTFOUND`），禁止只打印 `fetch failed`。
- 就绪超时后必须提示执行 `docker compose ps` 和 `docker compose logs --tail=200 api`。
- API 就绪等待只能处理启动/重启竞态；若服务持续启动失败，验收仍应失败并保留真实日志，禁止通过跳过 E2E 放行。
"""
if '## 6. Docker API 就绪与网络诊断' not in compat:
    compat += compat_append
compat_path.write_text(compat)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_needle = '- Docker E2E 的 fixture、查询条件、可搜索字段和预期 ID/数量必须形成显式契约。'
plan_replace = plan_needle + "\n- Docker E2E 必须先等待 `/api/health`，transport 错误必须包含 URL、底层 cause 与容器日志排查命令。"
if plan_needle not in plan:
    raise SystemExit('global plan rule insertion point not found')
plan = plan.replace(plan_needle, plan_replace, 1)
plan_path.write_text(plan)
