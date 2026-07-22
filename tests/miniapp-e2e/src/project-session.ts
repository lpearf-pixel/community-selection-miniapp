import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  InfrastructureError,
  type JsonLineReporter,
  type MiniProgramSession,
  WechatSessionFactory,
  withTimeout,
} from '@community-selection/miniapp-testkit';
import type { ProjectE2eConfig } from './config.js';

const SOURCE_CONTRACT = 'miniapp-e2e-v2';

function isPortOpen(port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function openProjectSession(
  config: ProjectE2eConfig,
  reporter: JsonLineReporter,
): Promise<MiniProgramSession> {
  const factory = new WechatSessionFactory();
  const endpoint = `ws://127.0.0.1:${config.port}`;
  reporter.step('automation-connect-start', { port: config.port });
  const reused = await isPortOpen(config.port);
  const session = reused
    ? await factory.connect({ wsEndpoint: endpoint, timeoutMs: config.launchTimeoutMs })
    : await factory.launch({
      cliPath: config.cliPath,
      projectPath: config.projectPath,
      port: config.port,
      timeoutMs: config.launchTimeoutMs,
    });
  reporter.step('automation-connected', { port: config.port, reused });
  return session;
}

export async function probeSourceContract(
  session: MiniProgramSession,
  timeoutMs: number,
): Promise<void> {
  if (!session.evaluate) throw new InfrastructureError(
    'MINIAPP_SOURCE_CONTRACT_MISMATCH: automation session cannot evaluate App state',
    { code: 'MINIAPP_SOURCE_CONTRACT_MISMATCH' },
  );
  const actual = await session.evaluate(
    'getApp().globalData.e2eContractVersion',
    { timeoutMs },
  );
  if (actual !== SOURCE_CONTRACT) {
    throw new InfrastructureError(
      `MINIAPP_SOURCE_CONTRACT_MISMATCH: expected ${SOURCE_CONTRACT}, received ${String(actual)}`,
      { code: 'MINIAPP_SOURCE_CONTRACT_MISMATCH' },
    );
  }
}

export async function captureProjectFailure(
  session: MiniProgramSession,
  reporter: JsonLineReporter,
  timeoutMs: number,
): Promise<void> {
  try {
    const page = await withTimeout(
      () => session.currentPage({ timeoutMs }),
      { label: 'read failure route', timeoutMs },
    );
    let wxml: string | undefined;
    if (page.wxml) {
      wxml = await withTimeout(() => page.wxml!(), {
        label: 'read failure WXML',
        timeoutMs,
      });
    }
    reporter.step('failure-page', { path: page.path, wxml });
    const screenshot = reporter.artifactPath('failure', 'png');
    await withTimeout(
      () => session.screenshot({ path: screenshot, timeoutMs }),
      { label: 'capture failure screenshot', timeoutMs },
    );
    reporter.step('failure-screenshot', { path: screenshot });
  } catch (error) {
    reporter.step('failure-evidence-error', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function writeProjectReport(reporter: JsonLineReporter): string {
  const target = reporter.artifactPath('report', 'json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({
    runId: reporter.runId,
    events: reporter.events(),
  }, null, 2)}\n`, 'utf8');
  return target;
}
