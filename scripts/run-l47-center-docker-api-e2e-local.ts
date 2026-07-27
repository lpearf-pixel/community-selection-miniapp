import { spawn } from 'node:child_process';
import { buildApp } from '../apps/api/src/app.js';
import { enableConsumerVerifierMockIdentity } from './lib/consumer-verifier-request.ts';

function runFocusedVerifier(apiBaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const noProxy = ['localhost', '127.0.0.1', '::1']
      .concat(String(process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',').filter(Boolean))
      .filter((value, index, items) => items.indexOf(value) === index)
      .join(',');

    const child = spawn(
      'pnpm',
      ['exec', 'tsx', 'scripts/verify-l47-center-docker-api-e2e-local.ts'],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: {
          ...process.env,
          API_BASE_URL: apiBaseUrl,
          NO_PROXY: noProxy,
          no_proxy: noProxy,
        },
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `L47 focused Docker E2E exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  enableConsumerVerifierMockIdentity();
  const app = buildApp();
  let address = '';

  try {
    address = await app.listen({ host: '127.0.0.1', port: 0 });
    console.log(`L47 isolated API ready at ${address}`);
    await runFocusedVerifier(address.replace(/\/$/, ''));
  } finally {
    await app.close();
    if (address) console.log('L47 isolated API closed.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
