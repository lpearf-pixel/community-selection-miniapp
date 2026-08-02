import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createRuntimePaths,
  requestRemoteDemoStop,
} from './lifecycle.mjs';
import { createConcreteDeps } from './start.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '../..');

export async function main(repoRoot = defaultRepoRoot) {
  const paths = createRuntimePaths(repoRoot);
  const deps = createConcreteDeps({
    config: { apiPort: 13180, adminPort: 13181 },
    paths,
    shutdown: {
      assertActive() {},
      waitForShutdown() {
        throw new Error('Stop command cannot wait for a startup lifecycle');
      },
    },
  });
  const result = await requestRemoteDemoStop(paths, deps);
  process.stdout.write(
    result.status === 'already_stopped'
      ? 'L58 remote demo is already stopped.\n'
      : 'L58 remote demo stop requested.\n',
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
