import {
  createCipheriv,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAndDecryptWechatNotification } from './wechat-notify-verifier.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const apiV3Key = '12345678901234567890123456789012';

function fixture(overrides: {
  serial?: string;
  timestamp?: number;
  resource?: Record<string, unknown>;
} = {}) {
  const timestamp = overrides.timestamp ?? 1_700_000_000;
  const headerNonce = 'header-nonce';
  const resourceNonce = Buffer.from('resource1234');
  const associatedData = 'transaction';
  const plaintext = JSON.stringify({
    mchid: 'merchant-a',
    out_trade_no: 'PAYORDER1',
    amount: { total: 1, payer_total: 1, currency: 'CNY' },
  });
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key),
    resourceNonce,
  );
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const envelope = {
    id: 'notification-a',
    event_type: 'TRANSACTION.SUCCESS',
    resource: overrides.resource ?? {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encrypted,
      nonce: resourceNonce.toString('utf8'),
      associated_data: associatedData,
    },
  };
  const rawBody = JSON.stringify(envelope);
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${headerNonce}\n${rawBody}\n`),
    privateKey,
  ).toString('base64');
  return {
    rawBody,
    headers: {
      'wechatpay-timestamp': String(timestamp),
      'wechatpay-nonce': headerNonce,
      'wechatpay-serial': overrides.serial ?? 'platform-serial',
      'wechatpay-signature': signature,
    },
  };
}

describe('WeChat notification verification', () => {
  it('verifies the raw body and decrypts an authenticated resource', () => {
    const input = fixture();
    expect(
      verifyAndDecryptWechatNotification({
        ...input,
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_100_000),
      }),
    ).toMatchObject({
      notificationId: 'notification-a',
      eventType: 'TRANSACTION.SUCCESS',
      resource: {
        mchid: 'merchant-a',
        out_trade_no: 'PAYORDER1',
        amount: { total: 1, currency: 'CNY' },
      },
    });
  });

  it('rejects wrong serials, stale timestamps, and changed raw bodies', () => {
    const wrongSerial = fixture({ serial: 'wrong' });
    expect(() =>
      verifyAndDecryptWechatNotification({
        ...wrongSerial,
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_000_000),
      }),
    ).toThrow(/WECHAT_NOTIFY_SERIAL_MISMATCH/);

    const stale = fixture();
    expect(() =>
      verifyAndDecryptWechatNotification({
        ...stale,
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_301_000),
      }),
    ).toThrow(/WECHAT_NOTIFY_TIMESTAMP_INVALID/);

    expect(() =>
      verifyAndDecryptWechatNotification({
        ...stale,
        rawBody: `${stale.rawBody} `,
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_000_000),
      }),
    ).toThrow(/WECHAT_NOTIFY_SIGNATURE_INVALID/);
  });

  it('rejects unsupported algorithms and failed GCM authentication', () => {
    const unsupported = fixture({
      resource: {
        algorithm: 'UNKNOWN',
        ciphertext: 'x',
        nonce: '123456789012',
        associated_data: '',
      },
    });
    expect(() =>
      verifyAndDecryptWechatNotification({
        ...unsupported,
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_000_000),
      }),
    ).toThrow(/WECHAT_NOTIFY_ALGORITHM_INVALID/);

    const tampered = fixture();
    const parsed = JSON.parse(tampered.rawBody);
    parsed.resource.ciphertext = Buffer.from('tampered').toString('base64');
    const rawBody = JSON.stringify(parsed);
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`1700000000\nheader-nonce\n${rawBody}\n`),
      privateKey,
    ).toString('base64');
    expect(() =>
      verifyAndDecryptWechatNotification({
        rawBody,
        headers: {
          ...tampered.headers,
          'wechatpay-signature': signature,
        },
        platformSerialNo: 'platform-serial',
        platformPublicKey: publicKey,
        apiV3Key,
        now: () => new Date(1_700_000_000_000),
      }),
    ).toThrow(/WECHAT_NOTIFY_DECRYPT_FAILED/);
  });
});
