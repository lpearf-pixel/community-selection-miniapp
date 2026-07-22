# Mini App Testkit

Reusable TypeScript primitives for native Mini Program end-to-end tests.

The package provides protocol-neutral session/page/element ports, bounded read retries, operation timeouts, page-object helpers, JSON-lines progress reporting, failure-safe lifecycle cleanup, and a maintained WeChat DevTools adapter.

It deliberately contains no application routes, selectors, API paths, fixtures, or business assertions. A consuming project supplies those under its own test directory.

## Runtime

- Node.js `^20.19.0 || >=22.12.0`
- Vitest for the consuming suite
- WeChat DevTools for real WeChat execution

## Package gates

```bash
pnpm --filter @community-selection/miniapp-testkit test
pnpm --filter @community-selection/miniapp-testkit typecheck
pnpm --filter @community-selection/miniapp-testkit build
```

## Minimal use

```ts
import {
  JsonLineReporter,
  MiniappDriver,
  WechatSessionFactory,
} from '@community-selection/miniapp-testkit';

const session = await new WechatSessionFactory().connect({
  wsEndpoint: 'ws://127.0.0.1:9420',
  timeoutMs: 60_000,
});
const reporter = new JsonLineReporter({ runId: 'example' });
const driver = new MiniappDriver({ session, reporter });

await driver.waitForRoute('pages/index/index');
```

Project fixtures and page objects should depend on the public exports only. That keeps the package movable to a separate repository without rewriting its consumers.
