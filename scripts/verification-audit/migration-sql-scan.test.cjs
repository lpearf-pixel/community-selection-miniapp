const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasUnsafeDropTable,
  stripNonExecutableSql,
} = require('../lib/migration-sql-scan.cjs');

test('ignores rollback prose and SQL string contents', () => {
  const sql = [
    '-- Rollback (manual): DROP TABLE "WithdrawalCommission";',
    "SELECT 'DROP TABLE quoted_text';",
    '/* DROP TABLE block_comment; */',
    'CREATE TABLE "SafeTable" ("id" TEXT);',
  ].join('\n');

  assert.doesNotMatch(stripNonExecutableSql(sql), /DROP\s+TABLE/i);
  assert.equal(hasUnsafeDropTable(sql), false);
});

test('allows guarded drops and rejects executable unguarded drops', () => {
  assert.equal(hasUnsafeDropTable('DROP TABLE IF EXISTS "SafeTable";'), false);
  assert.equal(hasUnsafeDropTable('DROP TABLE "UnsafeTable";'), true);
  assert.equal(
    hasUnsafeDropTable('DROP\nTABLE\n"UnsafeTable";'),
    true,
  );
});
