import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migrationsRoot = 'prisma/migrations';
const migrationSql = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'),
  )
  .join('\n');

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
  /ALTER TABLE "ConsumerCreditLedger"[\s\S]*?ADD COLUMN IF NOT EXISTS "affects_available_balance" BOOLEAN NOT NULL DEFAULT true/.test(
    migrationSql,
  ),
  'ConsumerCreditLedger.affects_available_balance has no deployable migration',
);

console.log('ConsumerCreditLedger schema drift verification passed.');
