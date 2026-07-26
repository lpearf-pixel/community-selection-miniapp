import { createHash } from 'node:crypto';

export type LeaderWithdrawalCommand = {
  client_request_id: string;
  commission_ids: string[];
  amount_cents?: number;
};

type ParseResult =
  | { ok: true; value: LeaderWithdrawalCommand }
  | {
      ok: false;
      code: 'INVALID_LEADER_WITHDRAWAL_COMMAND';
      message: string;
    };

const ALLOWED_KEYS = new Set([
  'client_request_id',
  'commission_ids',
  'amount_cents',
]);

function invalid(): ParseResult {
  return {
    ok: false,
    code: 'INVALID_LEADER_WITHDRAWAL_COMMAND',
    message: '提现申请命令不合法',
  };
}

export function parseLeaderWithdrawalCommand(input: unknown): ParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid();
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    return invalid();
  }
  if (
    typeof body.client_request_id !== 'string' ||
    body.client_request_id !== body.client_request_id.trim() ||
    body.client_request_id.length < 1 ||
    body.client_request_id.length > 80
  ) {
    return invalid();
  }
  if (
    !Array.isArray(body.commission_ids) ||
    body.commission_ids.length === 0 ||
    body.commission_ids.some(
      (id) =>
        typeof id !== 'string' ||
        id.length === 0 ||
        id !== id.trim(),
    )
  ) {
    return invalid();
  }
  const commissionIds = body.commission_ids as string[];
  if (new Set(commissionIds).size !== commissionIds.length) {
    return invalid();
  }
  if (
    body.amount_cents !== undefined &&
    (!Number.isSafeInteger(body.amount_cents) ||
      Number(body.amount_cents) <= 0)
  ) {
    return invalid();
  }
  return {
    ok: true,
    value: {
      client_request_id: body.client_request_id,
      commission_ids: [...commissionIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      ...(body.amount_cents === undefined
        ? {}
        : { amount_cents: Number(body.amount_cents) }),
    },
  };
}

export function buildLeaderWithdrawalSemanticSignature(input: {
  leader_user_id: string;
  client_request_id: string;
  commission_ids: string[];
  amount_cents: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        leader_user_id: input.leader_user_id,
        client_request_id: input.client_request_id,
        commission_ids: [...input.commission_ids].sort((left, right) =>
          left.localeCompare(right),
        ),
        amount_cents: input.amount_cents,
      }),
    )
    .digest('hex');
}
