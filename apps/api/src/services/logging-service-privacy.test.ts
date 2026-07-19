import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  raiseOpsAlert,
  recordBusinessEvent,
  recordOrderTimeline,
  resolveOpsAlert,
  safeLoggingFailureMetadata,
  safeRaiseOpsAlert,
  safeRecordBusinessEvent,
  safeRecordOrderTimeline,
  sanitizeLogText,
  sanitizePayload,
} from './logging-service.js';

const consoleErrorSpy = vi
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

afterEach(() => {
  consoleErrorSpy.mockClear();
});

describe('business log privacy', () => {
  it('recursively sanitizes identity, contact, address, account, and internal review fields', () => {
    const payload = {
      openid: 'openid-unique-secret',
      unionid: 'unionid-unique-secret',
      receiver_phone: '13912345678',
      receiver_name: '张三丰',
      receiver_address: '南京市玄武区安全测试路88号',
      bank_account: '6222021234567890',
      nested: {
        manual_reference: 'BANK-SECRET-9988',
        tax_remark: 'internal-tax-remark-secret',
        admin_remark: 'internal-admin-remark-secret',
        reviewed_by_admin_id: 'review-admin-secret',
        processed_by_admin_id: 'process-admin-secret',
        resolved_by: 'resolve-admin-secret',
        admin_user_id: 'admin-user-secret',
      },
    };

    const sanitized = sanitizePayload(payload) as typeof payload;
    const serialized = JSON.stringify(sanitized);

    for (const secret of [
      'openid-unique-secret',
      'unionid-unique-secret',
      '13912345678',
      '张三丰',
      '南京市玄武区安全测试路88号',
      '6222021234567890',
      'BANK-SECRET-9988',
      'internal-tax-remark-secret',
      'internal-admin-remark-secret',
      'review-admin-secret',
      'process-admin-secret',
      'resolve-admin-secret',
      'admin-user-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(sanitized.receiver_phone).toBe('139****5678');
    expect(sanitized.receiver_name).toBe('张*');
    expect(sanitized.receiver_address).toBe('南京市***8号');
    expect(sanitized.bank_account).toBe('****7890');
    expect(sanitized.nested).toMatchObject({
      manual_reference: '[FILTERED]',
      tax_remark: '[FILTERED]',
      admin_remark: '[FILTERED]',
      reviewed_by_admin_id: '[FILTERED]',
      processed_by_admin_id: '[FILTERED]',
      resolved_by: '[FILTERED]',
      admin_user_id: '[FILTERED]',
    });
  });

  it('sanitizes sensitive key-value text and phone-like values', () => {
    const input =
      'manual_reference=BANK-SECRET-9988; tax_remark: internal tax secret; ' +
      'admin_remark="admin note secret"; reviewed_by_admin_id=admin-secret-id; ' +
      'receiver_phone=13912345678; normal_status=completed';

    const sanitized = sanitizeLogText(input);

    expect(sanitized).toContain('normal_status=completed');
    expect(sanitized).toContain('139****5678');
    for (const secret of [
      'BANK-SECRET-9988',
      'internal tax secret',
      'admin note secret',
      'admin-secret-id',
      '13912345678',
    ]) {
      expect(sanitized).not.toContain(secret);
    }
  });

  it('sanitizes persisted business event messages and snapshots', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-1' });
    const client = { businessEventLog: { create } } as any;

    await recordBusinessEvent(client, {
      event_type: 'privacy_test',
      event_source: 'test',
      message:
        'tax_remark=internal-tax-message; receiver_phone=13912345678',
      before_snapshot: {
        manual_reference: 'BEFORE-REFERENCE-SECRET',
      },
      after_snapshot: {
        admin_remark: 'AFTER-ADMIN-SECRET',
      },
      payload: {
        reviewed_by_admin_id: 'ADMIN-ACTOR-SECRET',
      },
    });

    const data = create.mock.calls[0][0].data;
    const serialized = JSON.stringify(data);
    for (const secret of [
      'internal-tax-message',
      '13912345678',
      'BEFORE-REFERENCE-SECRET',
      'AFTER-ADMIN-SECRET',
      'ADMIN-ACTOR-SECRET',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(data.message).toContain('139****5678');
  });

  it('sanitizes timeline and alert text while preserving the resolution audit actor', async () => {
    const timelineCreate = vi.fn().mockResolvedValue({ id: 'timeline-1' });
    const alertCreate = vi.fn().mockResolvedValue({ id: 'alert-1' });
    const alertUpdate = vi.fn().mockResolvedValue({ id: 'alert-1' });
    const client = {
      orderTimelineLog: { create: timelineCreate },
      opsAlertLog: { create: alertCreate, update: alertUpdate },
    } as any;

    await recordOrderTimeline(client, {
      order_id: 'order-1',
      event_type: 'privacy_test',
      title: 'admin_remark=timeline-title-secret',
      message: 'manual_reference=timeline-message-secret',
      payload: { tax_remark: 'timeline-payload-secret' },
    });
    await raiseOpsAlert(client, {
      alert_type: 'privacy_test',
      title: 'tax_remark=alert-title-secret',
      message: 'admin_remark=alert-message-secret',
      payload: { manual_reference: 'alert-payload-secret' },
    });
    await resolveOpsAlert(client, {
      id: 'alert-1',
      status: 'resolved',
      resolved_by: 'admin-resolver-audit-id',
      resolution_note: 'tax_remark=resolution-note-secret',
    });

    const timelineSerialized = JSON.stringify(timelineCreate.mock.calls[0][0]);
    const alertSerialized = JSON.stringify(alertCreate.mock.calls[0][0]);
    const resolutionData = alertUpdate.mock.calls[0][0].data;
    const resolutionSerialized = JSON.stringify({
      ...resolutionData,
      resolved_by: '[AUDIT-ACTOR-OMITTED-FROM-PRIVACY-SCAN]',
    });

    for (const secret of [
      'timeline-title-secret',
      'timeline-message-secret',
      'timeline-payload-secret',
      'alert-title-secret',
      'alert-message-secret',
      'alert-payload-secret',
      'resolution-note-secret',
    ]) {
      expect(`${timelineSerialized}${alertSerialized}${resolutionSerialized}`).not.toContain(secret);
    }
    expect(resolutionData.resolved_by).toBe('admin-resolver-audit-id');
  });

  it('builds safe failure metadata without message, stack, or unsafe name/code values', () => {
    const error = Object.assign(new Error('unique-db-host-secret'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P9999',
      stack: 'unique-stack-secret',
    });

    expect(
      safeLoggingFailureMetadata('recordBusinessEvent', error, {
        trace_id: 'trace-123',
        request_id: 'request-456',
      }),
    ).toEqual({
      operation: 'recordBusinessEvent',
      error_name: 'PrismaClientKnownRequestError',
      error_code: 'P9999',
      trace_id: 'trace-123',
      request_id: 'request-456',
    });

    expect(
      safeLoggingFailureMetadata(
        'recordBusinessEvent',
        Object.assign(new Error('secret'), {
          name: 'DatabaseError@secret-host',
          code: 'host=secret-db',
        }),
      ),
    ).toEqual({
      operation: 'recordBusinessEvent',
      error_name: 'UnknownError',
      error_code: 'UNKNOWN',
    });
  });

  it('never writes raw error objects from safe logging fallbacks', async () => {
    const failure = Object.assign(new Error('unique-db-host-secret'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P9999',
      stack: 'unique-stack-secret',
    });
    const client = {
      businessEventLog: { create: vi.fn().mockRejectedValue(failure) },
      orderTimelineLog: { create: vi.fn().mockRejectedValue(failure) },
      opsAlertLog: { create: vi.fn().mockRejectedValue(failure) },
    } as any;

    await safeRecordBusinessEvent(client, {
      event_type: 'privacy_test',
      event_source: 'test',
      trace_id: 'trace-123',
      request_id: 'request-456',
      payload: { secret_input: 'payload-secret' },
    });
    await safeRecordOrderTimeline(client, {
      order_id: 'order-1',
      event_type: 'privacy_test',
      title: 'normal title',
      payload: { secret_input: 'payload-secret' },
    });
    await safeRaiseOpsAlert(client, {
      alert_type: 'privacy_test',
      title: 'normal title',
      message: 'normal message',
      payload: { secret_input: 'payload-secret' },
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(logged).toContain('P9999');
    expect(logged).toContain('recordBusinessEvent');
    expect(logged).toContain('recordOrderTimeline');
    expect(logged).toContain('raiseOpsAlert');
    for (const secret of [
      'unique-db-host-secret',
      'unique-stack-secret',
      'payload-secret',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
