const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const composePath = path.join(root, 'docker-compose.production.yml');

function loadCompose() {
  const parser = [
    'import json, sys, yaml',
    'with open(sys.argv[1], encoding="utf-8") as stream:',
    '  print(json.dumps(yaml.safe_load(stream)))',
  ].join('\n');
  return JSON.parse(
    execFileSync('python3', ['-c', parser, composePath], {
      encoding: 'utf8',
    }),
  );
}

test('keeps PostgreSQL and API off host ports behind the HTTPS edge', () => {
  const compose = loadCompose();
  assert.deepEqual(Object.keys(compose.services).sort(), [
    'api',
    'backup',
    'edge',
    'migrate',
    'postgres',
    'restore',
  ]);
  assert.equal(compose.services.postgres.ports, undefined);
  assert.equal(compose.services.api.ports, undefined);
  assert.deepEqual(compose.services.edge.ports, ['80:80', '443:443']);
  assert.equal(compose.networks.backend.internal, true);
  assert.equal(compose.networks.egress.internal, undefined);
  assert.deepEqual(compose.services.postgres.networks, ['backend']);
  assert.deepEqual(compose.services.api.networks.sort(), ['backend', 'egress']);
  assert.deepEqual(compose.services.edge.networks.sort(), [
    'backend',
    'public',
  ]);
});

test('keeps the Caddy administration API on container loopback', () => {
  const caddyfile = fs.readFileSync(
    path.join(root, 'Caddyfile.production'),
    'utf8',
  );
  assert.doesNotMatch(caddyfile, /admin\s+0\.0\.0\.0:2019/);
});

test('runs migration successfully before starting the API', () => {
  const compose = loadCompose();
  assert.equal(
    compose.services.migrate.depends_on.postgres.condition,
    'service_healthy',
  );
  assert.equal(
    compose.services.api.depends_on.migrate.condition,
    'service_completed_successfully',
  );
  assert.match(compose.services.migrate.command.join(' '), /validate-env/);
  assert.match(compose.services.migrate.command.join(' '), /migrate deploy/);
  assert.match(
    compose.services.api.healthcheck.test.join(' '),
    /api\/health/,
  );
});

test('pins application images and mounts payment secrets read-only', () => {
  const compose = loadCompose();
  assert.match(compose.services.api.image, /\$\{IMAGE_TAG:/);
  assert.match(compose.services.edge.image, /\$\{IMAGE_TAG:/);
  assert.equal(compose.services.api.deploy.replicas, 1);
  assert.equal(compose.services.api.environment.NODE_ENV, 'production');
  assert.equal(
    compose.services.api.environment.CURRENT_USER_MOCK_HEADERS_ENABLED,
    'false',
  );
  assert.ok(
    compose.services.api.volumes.includes(
      './secrets/wechat_private_key.pem:/run/secrets/wechat_private_key.pem:ro',
    ),
  );
  assert.ok(
    compose.services.api.volumes.includes(
      './secrets/wechat_platform_certificate.pem:/run/secrets/wechat_platform_certificate.pem:ro',
    ),
  );
});

test('keeps destructive and maintenance jobs behind explicit profiles', () => {
  const compose = loadCompose();
  assert.deepEqual(compose.services.backup.profiles, ['maintenance']);
  assert.deepEqual(compose.services.restore.profiles, ['restore']);
  assert.equal(compose.services.backup.restart, 'no');
  assert.equal(compose.services.restore.restart, 'no');
  assert.ok(
    compose.services.backup.volumes.includes(
      'production-backups:/var/backups/community-selection',
    ),
  );
  assert.ok(
    compose.services.restore.volumes.includes(
      'production-backups:/var/backups/community-selection',
    ),
  );
});

test('defines every production build target and excludes secret material', () => {
  const dockerfile = fs.readFileSync(
    path.join(root, 'Dockerfile.production'),
    'utf8',
  );
  for (const target of ['api', 'edge', 'ops']) {
    assert.match(dockerfile, new RegExp(`AS ${target}\\b`));
  }
  const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  assert.match(dockerignore, /secrets/);
  assert.match(dockerignore, /\.env\.production/);
});
