import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AdminWithdrawalCommandError,
  assertAdminWithdrawalEligibility,
} from '../apps/api/src/modules/withdrawal/admin-withdrawal-executor.ts';

const pending = {
  id: 'withdrawal-1',
  version: 2,
  status: 'pending',
  tax_status: 'pending',
  payable_amount_cents: 800,
  invoice_required: false,
  invoice_status: 'not_required',
  commission_links: [
    {
      commission: {
        id: 'commission-1',
        status: 'withdrawing',
        withdrawal_id: 'withdrawal-1',
      },
    },
  ],
};

test('approve and reject accept only the current pending version', () => {
  assert.doesNotThrow(() =>
    assertAdminWithdrawalEligibility(
      'approve',
      pending,
      pending.version,
    ),
  );
  assert.doesNotThrow(() =>
    assertAdminWithdrawalEligibility(
      'reject',
      pending,
      pending.version,
    ),
  );
  assert.throws(
    () => assertAdminWithdrawalEligibility('approve', pending, 1),
    (error) =>
      error instanceof AdminWithdrawalCommandError &&
      error.statusCode === 409 &&
      error.code === 'ADMIN_WITHDRAWAL_VERSION_CONFLICT',
  );
});

test('mark-paid enforces approved state and completed manual tax review', () => {
  assert.doesNotThrow(() =>
    assertAdminWithdrawalEligibility(
      'mark-paid',
      {
        ...pending,
        version: 3,
        status: 'approved',
        tax_status: 'completed',
      },
      3,
    ),
  );
  assert.throws(
    () =>
      assertAdminWithdrawalEligibility(
        'mark-paid',
        { ...pending, status: 'approved' },
        pending.version,
      ),
    (error) =>
      error instanceof AdminWithdrawalCommandError &&
      error.code === 'ADMIN_WITHDRAWAL_TAX_CONFLICT',
  );
});

test('reject and mark-paid require every linked reward to remain reserved', () => {
  assert.throws(
    () =>
      assertAdminWithdrawalEligibility(
        'reject',
        {
          ...pending,
          commission_links: [
            {
              commission: {
                id: 'commission-1',
                status: 'available',
                withdrawal_id: null,
              },
            },
          ],
        },
        pending.version,
      ),
    (error) =>
      error instanceof AdminWithdrawalCommandError &&
      error.code === 'ADMIN_WITHDRAWAL_REWARD_CONFLICT',
  );
});

test('executor composes receipt, versioned state, reward and audit writes in one transaction', async () => {
  const source = await readFile(
    new URL(
      '../apps/api/src/modules/withdrawal/admin-withdrawal-executor.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    source,
    /export async function executeAdminWithdrawalCommand\(/,
  );
  assert.match(source, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(source, /tx\.adminCommandReceipt\.create\(/);
  assert.match(
    source,
    /version:\s*input\.command\.expected_version[\s\S]*?version:\s*\{\s*increment:\s*1\s*\}/,
  );
  assert.match(source, /tx\.commission\.updateMany\(/);
  assert.match(source, /appendRewardLedgerEntry\(tx,/);
  assert.match(source, /recordAdminAudit\(tx,/);
  assert.match(source, /recordBusinessEvent\(tx,/);
  assert.match(source, /recordOrderTimeline\(tx,/);
});

test('all three Admin routes parse and execute reliable withdrawal commands', async () => {
  const source = await readFile(
    new URL('../apps/api/src/routes/withdrawals.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /parseAdminWithdrawalCommand,\s*type AdminWithdrawalAction,/,
  );
  assert.match(
    source,
    /AdminWithdrawalCommandError,\s*executeAdminWithdrawalCommand,/,
  );
  for (const action of ['approve', 'reject', 'mark-paid']) {
    assert.match(
      source,
      new RegExp(
        `"/api/admin/withdrawals/:id/${action}"[\\s\\S]*?executeReliableWithdrawal\\(request, reply, "${action}"\\)`,
      ),
    );
  }
  assert.doesNotMatch(
    source,
    /"\/api\/admin\/withdrawals\/:id\/approve"[\s\S]*?prisma\.\$transaction/,
  );
});

test('manual tax review advances the withdrawal command version', async () => {
  const source = await readFile(
    new URL('../apps/api/src/routes/withdrawals.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /where:\s*\{\s*id,\s*updated_at:\s*expectedUpdatedAt\s*\}[\s\S]*?version:\s*\{\s*increment:\s*1\s*\}/,
  );
});
