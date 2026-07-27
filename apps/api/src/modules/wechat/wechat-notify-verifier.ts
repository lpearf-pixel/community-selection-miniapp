import {
  createDecipheriv,
  createHash,
  verify,
} from 'node:crypto';

type HeaderMap = Record<string, unknown>;

function stringHeader(headers: HeaderMap, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const item = value.find(
      (entry): entry is string =>
        typeof entry === 'string' && Boolean(entry.trim()),
    );
    if (item) return item.trim();
  }
  throw new Error('WECHAT_NOTIFY_HEADERS_MISSING');
}

function decryptResource(input: {
  resource: Record<string, unknown>;
  apiV3Key: string;
}): Record<string, unknown> {
  if (input.resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('WECHAT_NOTIFY_ALGORITHM_INVALID');
  }
  const ciphertext = input.resource.ciphertext;
  const nonce = input.resource.nonce;
  const associatedData = input.resource.associated_data;
  if (
    typeof ciphertext !== 'string' ||
    typeof nonce !== 'string' ||
    (associatedData !== undefined && typeof associatedData !== 'string')
  ) {
    throw new Error('WECHAT_NOTIFY_RESOURCE_INVALID');
  }
  const encrypted = Buffer.from(ciphertext, 'base64');
  if (encrypted.length <= 16 || Buffer.byteLength(input.apiV3Key) !== 32) {
    throw new Error('WECHAT_NOTIFY_DECRYPT_FAILED');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(input.apiV3Key),
      Buffer.from(nonce),
    );
    decipher.setAAD(Buffer.from(associatedData ?? ''));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    const plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(0, encrypted.length - 16)),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('WECHAT_NOTIFY_DECRYPT_FAILED');
  }
}

export function verifyAndDecryptWechatNotification(input: {
  rawBody: string | Buffer;
  headers: HeaderMap;
  platformSerialNo: string;
  platformPublicKey: string | Buffer;
  apiV3Key: string;
  now?: () => Date;
  toleranceSeconds?: number;
}) {
  const rawBody = Buffer.isBuffer(input.rawBody)
    ? input.rawBody.toString('utf8')
    : input.rawBody;
  const timestampText = stringHeader(
    input.headers,
    'wechatpay-timestamp',
  );
  const nonce = stringHeader(input.headers, 'wechatpay-nonce');
  const serial = stringHeader(input.headers, 'wechatpay-serial');
  const signature = stringHeader(input.headers, 'wechatpay-signature');
  if (serial !== input.platformSerialNo) {
    throw new Error('WECHAT_NOTIFY_SERIAL_MISMATCH');
  }
  const timestamp = Number(timestampText);
  const currentSeconds = Math.floor(
    (input.now?.() ?? new Date()).getTime() / 1_000,
  );
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(currentSeconds - timestamp) >
      (input.toleranceSeconds ?? 300)
  ) {
    throw new Error('WECHAT_NOTIFY_TIMESTAMP_INVALID');
  }
  const message = `${timestampText}\n${nonce}\n${rawBody}\n`;
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signature, 'base64');
  } catch {
    throw new Error('WECHAT_NOTIFY_SIGNATURE_INVALID');
  }
  if (
    !verify(
      'RSA-SHA256',
      Buffer.from(message),
      input.platformPublicKey,
      signatureBuffer,
    )
  ) {
    throw new Error('WECHAT_NOTIFY_SIGNATURE_INVALID');
  }

  let envelope: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    envelope = parsed as Record<string, unknown>;
  } catch {
    throw new Error('WECHAT_NOTIFY_BODY_INVALID');
  }
  if (
    typeof envelope.id !== 'string' ||
    typeof envelope.event_type !== 'string' ||
    !envelope.resource ||
    typeof envelope.resource !== 'object' ||
    Array.isArray(envelope.resource)
  ) {
    throw new Error('WECHAT_NOTIFY_BODY_INVALID');
  }

  return {
    notificationId: envelope.id,
    eventType: envelope.event_type,
    bodySha256: createHash('sha256').update(rawBody).digest('hex'),
    resource: decryptResource({
      resource: envelope.resource as Record<string, unknown>,
      apiV3Key: input.apiV3Key,
    }),
  };
}
