const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..', '..');
const afterSales = readFileSync(
  join(root, 'apps/api/src/routes/after-sales.ts'),
  'utf8',
);
const refunds = readFileSync(
  join(root, 'apps/api/src/routes/refunds.ts'),
  'utf8',
);
const fixture = readFileSync(
  join(root, 'scripts/admin-e2e/fixture.ts'),
  'utf8',
);
const smoke = readFileSync(
  join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
  'utf8',
);

test('refund execution has one protected Admin write boundary', () => {
  assert.match(
    afterSales,
    /\/api\/admin\/after-sales\/:id\/refund-execute/,
  );
  assert.match(afterSales, /requireAdminPermissionV1\(\s*\[/);
  assert.match(afterSales, /'after_sale\.manage'/);
  assert.match(afterSales, /'refund\.manage'/);
  assert.match(afterSales, /parseAdminRefundCommand\(request\.body\)/);
  assert.match(afterSales, /executeAdminRefundCommand\(/);
});

test('Admin after-sale list exposes reliable refund execution inputs', () => {
  assert.match(afterSales, /resolution_type:\s*item\.resolution_type/);
  assert.match(afterSales, /version:\s*order\.version/);
});

test('public refund mutations are retired while notify fails closed', () => {
  assert.doesNotMatch(refunds, /app\.post\('\/api\/refunds\/mock'/);
  assert.doesNotMatch(refunds, /app\.post\('\/api\/refunds\/wechat\/apply'/);
  assert.match(refunds, /app\.post\('\/api\/refunds\/wechat\/notify'/);
  assert.match(refunds, /reply\.code\(501\)/);
});

test('real Admin browser proves same-version refund execution is atomic', () => {
  assert.match(fixture, /const refundOrderNo = /);
  assert.match(fixture, /const refundOrder = await prisma\.order\.create\(/);
  assert.match(fixture, /const refundCase = await prisma\.afterSaleCase\.create\(/);
  assert.match(fixture, /resolution_type:\s*'partial_refund'/);
  assert.match(fixture, /refundOrderId:\s*refundOrder\.id/);
  assert.match(fixture, /refundCaseId:\s*refundCase\.id/);

  assert.match(smoke, /const refundConflictPage = await context\.newPage\(\)/);
  assert.match(
    smoke,
    /\/api\/admin\/after-sales\/\$\{credentials\.refundCaseId\}\/refund-execute/,
  );
  assert.match(smoke, /assert\.deepEqual\(refundRaceCodes,\s*\[200,\s*409\]\)/);
  assert.match(smoke, /assert\.equal\(refundOrderEnvelope\.data\.items\[0\]\.version,\s*2\)/);
  assert.match(smoke, /assert\.equal\(refundLedgerEnvelope\.data\.total,\s*1\)/);
});
