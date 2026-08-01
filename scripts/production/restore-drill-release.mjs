import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvFile } from './preflight.mjs';

export function readRestoreDrillReleaseSha(envFile) {
  const releaseSha = readEnvFile(path.resolve(envFile)).IMAGE_TAG;
  if (!/^[a-f0-9]{40}$/.test(releaseSha ?? '')) {
    throw new Error('IMAGE_TAG must be an exact lowercase 40-character release SHA');
  }
  return releaseSha;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const envFile = process.argv[2];
    if (!envFile) throw new Error('env file path is required');
    process.stdout.write(`${readRestoreDrillReleaseSha(envFile)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
