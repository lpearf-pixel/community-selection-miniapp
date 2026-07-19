import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migrationSql = readFileSync(
  'prisma/migrations/202607190001_consumer_credit_ledger_balance_flag/migration.sql',
  'utf8',
);
const executableMigrationSql = migrationSql
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

const consumerCreditModel = schema.match(
  /model ConsumerCreditLedger \{[\s\S]*?\n\}/,
)?.[0];

assert(consumerCreditModel, 'ConsumerCreditLedger model is missing');
assert(
  consumerCreditModel.includes(
    'affects_available_balance Boolean @default(true)',
  ),
  'ConsumerCreditLedger schema balance flag is missing',
);
assert(
  executableMigrationSql ===
    'ALTER TABLE "ConsumerCreditLedger" ADD COLUMN IF NOT EXISTS "affects_available_balance" BOOLEAN NOT NULL DEFAULT true;',
  'ConsumerCreditLedger balance flag migration must contain exactly one deployable ALTER TABLE statement',
);

console.log('ConsumerCreditLedger schema drift verification passed.');
