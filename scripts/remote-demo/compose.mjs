import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_CACHE_VOLUME_NAMES = Object.freeze([
  'community-selection-l58-api-node-modules-cache',
  'community-selection-l58-pnpm-store-cache',
]);

function derivedSecret(label, source) {
  return crypto
    .createHash('sha256')
    .update(`community-selection-l58:${label}:${source}`)
    .digest('base64url');
}

export function renderDemoCompose(config, { repoRoot }) {
  if (!config || typeof config !== 'object') {
    throw new Error('Validated demo config is required');
  }
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('repoRoot must be an absolute path');
  }

  const databasePassword = derivedSecret(
    'database',
    config.sessionTokenSecret,
  );
  const memberPhoneHmacSecret = derivedSecret(
    'member-phone',
    config.sessionTokenSecret,
  );
  const apiCommand = [
    'corepack enable',
    'corepack prepare pnpm@9.15.4 --activate',
    'pnpm config set registry https://registry.npmjs.org/',
    'pnpm config set store-dir /opt/pnpm/store',
    'pnpm install --frozen-lockfile --prefer-offline',
    'pnpm --filter @community-selection/shared build',
    'pnpm --filter @community-selection/config build',
    'pnpm db:generate',
    'pnpm exec prisma migrate deploy --schema prisma/schema.prisma',
    'pnpm db:seed',
    'pnpm --filter @community-selection/api dev',
  ].join(' && ');

  return {
    services: {
      postgres: {
        image: 'postgres:16',
        restart: 'no',
        environment: {
          POSTGRES_USER: 'l58_demo',
          POSTGRES_PASSWORD: databasePassword,
          POSTGRES_DB: 'community_selection_l58_demo',
        },
        volumes: [
          {
            type: 'volume',
            source: 'postgres_data',
            target: '/var/lib/postgresql/data',
          },
        ],
        healthcheck: {
          test: [
            'CMD-SHELL',
            'pg_isready -U l58_demo -d community_selection_l58_demo',
          ],
          interval: '5s',
          timeout: '5s',
          retries: 12,
        },
      },
      api: {
        build: {
          context: repoRoot,
          dockerfile: 'Dockerfile.dev',
        },
        image: 'community-selection-api-l58-demo',
        restart: 'no',
        working_dir: '/app',
        depends_on: {
          postgres: { condition: 'service_healthy' },
        },
        environment: {
          NODE_ENV: 'development',
          PORT: '13080',
          DATABASE_URL:
            `postgresql://l58_demo:${databasePassword}` +
            '@postgres:5432/community_selection_l58_demo?schema=public',
          MEMBER_PHONE_HMAC_SECRET: memberPhoneHmacSecret,
          WECHAT_APP_ID: config.appId,
          WECHAT_APP_SECRET: config.appSecret,
          USER_SESSION_TOKEN_SECRET: config.sessionTokenSecret,
          ADMIN_TOKEN: config.adminToken,
          WECHAT_PAY_MODE: 'mock',
          MOCK_WECHAT_PAY: 'true',
          CURRENT_USER_MOCK_HEADERS_ENABLED: 'false',
          ADMIN_AUTH_ENABLED: 'true',
          ADMIN_AUTH_MODE: 'token',
          AUTO_PAYOUT_ENABLED: 'false',
          AUTO_TAX_FILING_ENABLED: 'false',
          WECHAT_TRANSFER_ENABLED: 'false',
          WECHAT_MERCHANT_TRANSFER_ENABLED: 'false',
          FIRST_LAUNCH_MODE: 'true',
          MEMBERSHIP_ENABLED: 'false',
          COUPONS_ENABLED: 'false',
          CASH_REWARDS_ENABLED: 'false',
          WITHDRAWALS_ENABLED: 'false',
        },
        ports: [
          {
            target: 13080,
            published: String(config.apiPort),
            host_ip: '127.0.0.1',
            protocol: 'tcp',
          },
        ],
        volumes: [
          {
            type: 'bind',
            source: repoRoot,
            target: '/app',
          },
          {
            type: 'volume',
            source: 'api_node_modules',
            target: '/app/node_modules',
          },
          {
            type: 'volume',
            source: 'api_package_store',
            target: '/opt/pnpm/store',
          },
        ],
        command: ['sh', '-lc', apiCommand],
        healthcheck: {
          test: [
            'CMD-SHELL',
            'curl -fsS http://localhost:13080/api/health >/dev/null || exit 1',
          ],
          interval: '5s',
          timeout: '5s',
          retries: 36,
          start_period: '30s',
        },
      },
    },
    volumes: {
      postgres_data: {},
      api_node_modules: {
        external: true,
        name: DEMO_CACHE_VOLUME_NAMES[0],
      },
      api_package_store: {
        external: true,
        name: DEMO_CACHE_VOLUME_NAMES[1],
      },
    },
  };
}

export function writeDemoCompose(model, outputPath) {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new Error('Compose output path must be absolute');
  }
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(model, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
  return outputPath;
}
