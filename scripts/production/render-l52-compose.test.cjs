const assert = require('node:assert/strict');
const test = require('node:test');

const productionConfig = {
  services: {
    migrate: {
      volumes: [
        {
          type: 'bind',
          source: '/workspace/secrets/wechat_private_key.pem',
          target: '/run/secrets/wechat_private_key.pem',
          read_only: true,
        },
        {
          type: 'bind',
          source: '/workspace/secrets/wechat_platform_certificate.pem',
          target: '/run/secrets/wechat_platform_certificate.pem',
          read_only: true,
        },
      ],
    },
    api: {
      volumes: [
        {
          type: 'bind',
          source: '/workspace/secrets/wechat_private_key.pem',
          target: '/run/secrets/wechat_private_key.pem',
          read_only: true,
        },
        {
          type: 'bind',
          source: '/workspace/secrets/wechat_platform_certificate.pem',
          target: '/run/secrets/wechat_platform_certificate.pem',
          read_only: true,
        },
      ],
    },
    backup: {
      volumes: [
        {
          type: 'volume',
          source: 'production-backups',
          target: '/var/backups/community-selection',
        },
        {
          type: 'bind',
          source: '/workspace/secrets/backup_passphrase',
          target: '/run/secrets/backup_passphrase',
          read_only: true,
        },
      ],
    },
    restore: {
      volumes: [
        {
          type: 'volume',
          source: 'production-backups',
          target: '/var/backups/community-selection',
        },
        {
          type: 'bind',
          source: '/workspace/secrets/backup_passphrase',
          target: '/run/secrets/backup_passphrase',
          read_only: true,
        },
      ],
    },
    postgres: {
      volumes: [
        {
          type: 'volume',
          source: 'production-postgres',
          target: '/var/lib/postgresql/data',
        },
      ],
    },
  },
  volumes: {
    'production-backups': {},
    'production-postgres': {},
  },
};

test('replaces CI secret file binds with one read-only external volume directory', async () => {
  const { renderL52Compose } = await import('./render-l52-compose.mjs');
  const rendered = renderL52Compose(productionConfig, {
    secretVolumeName: 'community-selection-l52-123-secrets',
  });

  for (const serviceName of ['migrate', 'api', 'backup', 'restore']) {
    const secretMounts = rendered.services[serviceName].volumes.filter(
      (mount) => mount.target.startsWith('/run/secrets'),
    );
    assert.deepEqual(secretMounts, [
      {
        type: 'volume',
        source: 'l52-secrets',
        target: '/run/secrets',
        read_only: true,
      },
    ]);
  }

  assert.deepEqual(rendered.volumes['l52-secrets'], {
    external: true,
    name: 'community-selection-l52-123-secrets',
  });
  assert.ok(
    rendered.services.backup.volumes.some(
      (mount) => mount.target === '/var/backups/community-selection',
    ),
  );
  assert.ok(
    rendered.services.postgres.volumes.some(
      (mount) => mount.target === '/var/lib/postgresql/data',
    ),
  );
});

test('rejects a production config missing a required secret consumer', async () => {
  const { renderL52Compose } = await import('./render-l52-compose.mjs');
  const incomplete = structuredClone(productionConfig);
  delete incomplete.services.restore;

  assert.throws(
    () =>
      renderL52Compose(incomplete, {
        secretVolumeName: 'community-selection-l52-123-secrets',
      }),
    /required service restore/i,
  );
});
