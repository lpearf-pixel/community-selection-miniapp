import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildLeaderWithdrawalSemanticSignature,
  parseLeaderWithdrawalCommand,
} from './leader-withdrawal-command.js';

const valid = {
  client_request_id: 'leader-withdrawal-request-001',
  commission_ids: ['commission-b', 'commission-a'],
  amount_cents: 3200,
};

describe('parseLeaderWithdrawalCommand', () => {
  it('normalizes commission ids into lexical order', () => {
    expect(parseLeaderWithdrawalCommand(valid)).toEqual({
      ok: true,
      value: {
        client_request_id: 'leader-withdrawal-request-001',
        commission_ids: ['commission-a', 'commission-b'],
        amount_cents: 3200,
      },
    });
  });

  it.each([
    null,
    [],
    {},
    { ...valid, unknown: true },
    { ...valid, client_request_id: ' request-001' },
    { ...valid, client_request_id: '' },
    { ...valid, client_request_id: 'x'.repeat(81) },
    { ...valid, commission_ids: [] },
    { ...valid, commission_ids: ['commission-a', 'commission-a'] },
    { ...valid, commission_ids: ['commission-a', ''] },
    { ...valid, amount_cents: 0 },
    { ...valid, amount_cents: 1.2 },
    { ...valid, amount_cents: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects a malformed or ambiguous command %#', (input) => {
    expect(parseLeaderWithdrawalCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_LEADER_WITHDRAWAL_COMMAND',
      message: '提现申请命令不合法',
    });
  });

  it('allows amount_cents to be omitted as a consistency assertion', () => {
    expect(
      parseLeaderWithdrawalCommand({
        client_request_id: valid.client_request_id,
        commission_ids: ['commission-a'],
      }),
    ).toEqual({
      ok: true,
      value: {
        client_request_id: valid.client_request_id,
        commission_ids: ['commission-a'],
      },
    });
  });
});

describe('buildLeaderWithdrawalSemanticSignature', () => {
  it('hashes the persisted command semantics with a literal canonical shape', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          leader_user_id: 'leader-1',
          client_request_id: 'leader-withdrawal-request-001',
          commission_ids: ['commission-a', 'commission-b'],
          amount_cents: 3200,
        }),
      )
      .digest('hex');

    expect(
      buildLeaderWithdrawalSemanticSignature({
        leader_user_id: 'leader-1',
        client_request_id: 'leader-withdrawal-request-001',
        commission_ids: ['commission-b', 'commission-a'],
        amount_cents: 3200,
      }),
    ).toBe(expected);
  });
});
