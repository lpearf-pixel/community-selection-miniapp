import { describe, expect, it } from 'vitest';
import {
  assertLeaderWithdrawalReplay,
  LeaderWithdrawalCommandError,
} from './leader-withdrawal-executor.js';

const existing = {
  id: 'withdrawal-1',
  leader_user_id: 'leader-1',
  client_request_id: 'request-1',
  amount_cents: 3200,
  status: 'pending',
  created_at: new Date('2026-07-26T00:00:00.000Z'),
  reviewed_at: null,
  processed_at: null,
  manual_reference: null,
  commission_links: [
    { commission_id: 'commission-a', amount_cents: 1200 },
    { commission_id: 'commission-b', amount_cents: 2000 },
  ],
};

describe('assertLeaderWithdrawalReplay', () => {
  it('replays only the same leader, commission set, and persisted amount', () => {
    expect(
      assertLeaderWithdrawalReplay(existing, {
        leader_user_id: 'leader-1',
        command: {
          client_request_id: 'request-1',
          commission_ids: ['commission-b', 'commission-a'],
        },
      }),
    ).toMatchObject({
      withdrawal_id: 'withdrawal-1',
      amount_cents: 3200,
      commission_count: 2,
      idempotent: true,
      applied: false,
    });
  });

  it.each([
    {
      leader_user_id: 'leader-2',
      command: {
        client_request_id: 'request-1',
        commission_ids: ['commission-a', 'commission-b'],
      },
    },
    {
      leader_user_id: 'leader-1',
      command: {
        client_request_id: 'request-1',
        commission_ids: ['commission-a'],
      },
    },
    {
      leader_user_id: 'leader-1',
      command: {
        client_request_id: 'request-1',
        commission_ids: ['commission-a', 'commission-b'],
        amount_cents: 3199,
      },
    },
  ])('rejects GR-FIN-003 command drift %#', (input) => {
    expect(() =>
      assertLeaderWithdrawalReplay(existing, input),
    ).toThrowError(LeaderWithdrawalCommandError);
    try {
      assertLeaderWithdrawalReplay(existing, input);
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 409,
        code: 'LEADER_WITHDRAWAL_IDEMPOTENCY_CONFLICT',
      });
    }
  });
});
