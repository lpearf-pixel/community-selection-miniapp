import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../../../../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migrationUrl = new URL(
  '../../../../../prisma/migrations/202607270001_l51_wechat_commerce_loop/migration.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, 'utf8')
  : '';

describe('L51 WeChat persistence contract', () => {
  it('owns sessions and notification receipts explicitly', () => {
    expect(schema).toContain('model UserSession');
    expect(schema).toContain('model WechatNotificationReceipt');
    expect(schema).toMatch(/token_hash\s+String\s+@unique/);
    expect(schema).toMatch(/notification_id\s+String\s+@unique/);
  });

  it('tracks retryable provider state without raw notification storage', () => {
    expect(schema).toMatch(/attempt_no\s+Int\s+@default\(1\)/);
    expect(schema).toContain('@@unique([order_id, attempt_no])');
    expect(schema).toMatch(/prepay_expires_at\s+DateTime\?/);
    expect(schema).toMatch(/provider_success_at\s+DateTime\?/);
    expect(schema).toMatch(/provider_status\s+String\?/);
    expect(schema).not.toMatch(/\sraw_notify\s+Json\?/);
  });

  it('deduplicates operational alerts and preserves database constraints', () => {
    expect(schema).toMatch(/dedupe_key\s+String\?\s+@unique/);
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "UserSession_token_hash_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "WechatNotificationReceipt_notification_id_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "Payment_order_id_attempt_no_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "OpsAlertLog_dedupe_key_key"',
    );
  });
});
