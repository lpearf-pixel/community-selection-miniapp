import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const secretConsumers = ['migrate', 'api', 'backup', 'restore'];

function isSecretMount(mount) {
  return (
    typeof mount === 'object' &&
    mount !== null &&
    typeof mount.target === 'string' &&
    (mount.target === '/run/secrets' ||
      mount.target.startsWith('/run/secrets/'))
  );
}

export function renderL52Compose(config, { secretVolumeName }) {
  if (typeof secretVolumeName !== 'string' || secretVolumeName.length === 0) {
    throw new Error('L52 secret volume name is required');
  }

  const rendered = structuredClone(config);
  rendered.services ??= {};
  rendered.volumes ??= {};

  for (const serviceName of secretConsumers) {
    const service = rendered.services[serviceName];
    if (!service) {
      throw new Error(`Required service ${serviceName} is missing`);
    }

    const volumes = Array.isArray(service.volumes) ? service.volumes : [];
    if (!volumes.some(isSecretMount)) {
      throw new Error(
        `Required service ${serviceName} has no production secret mount`,
      );
    }

    service.volumes = [
      ...volumes.filter((mount) => !isSecretMount(mount)),
      {
        type: 'volume',
        source: 'l52-secrets',
        target: '/run/secrets',
        read_only: true,
      },
    ];
  }

  rendered.volumes['l52-secrets'] = {
    external: true,
    name: secretVolumeName,
  };
  return rendered;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const input = optionValue('--input');
  const output = optionValue('--output');
  const secretVolumeName = optionValue('--secret-volume');
  if (!input || !output || !secretVolumeName) {
    throw new Error(
      'Usage: render-l52-compose.mjs --input <json> --output <json> --secret-volume <name>',
    );
  }

  const rendered = renderL52Compose(
    JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')),
    { secretVolumeName },
  );
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(rendered)}\n`, {
    mode: 0o600,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
