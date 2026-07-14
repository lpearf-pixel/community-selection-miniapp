-- L43 RewardLedger idempotency key unique-index finalization.
-- This migration converts the earlier hand-written partial unique index into the full
-- nullable unique index expected by Prisma for `idempotency_key String? @unique`.
-- PostgreSQL unique indexes allow multiple NULL values, so historical rows without
-- idempotency keys remain compatible.

-- If any non-null historical idempotency keys were duplicated before the unique index
-- existed, keep the first row unchanged and rewrite only later duplicate keys to a
-- deterministic legacy key. Financial ledger facts are not modified.
WITH ranked AS (
  SELECT
    id,
    idempotency_key,
    ROW_NUMBER() OVER (
      PARTITION BY idempotency_key
      ORDER BY created_at, id
    ) AS row_number
  FROM "RewardLedger"
  WHERE idempotency_key IS NOT NULL
)
UPDATE "RewardLedger" AS ledger
SET idempotency_key = ledger.idempotency_key || ':legacy:' || ledger.id
FROM ranked
WHERE ledger.id = ranked.id
  AND ranked.row_number > 1;

-- The previous L43 migration used a partial unique index with the Prisma-generated
-- name. Prisma migrate dev does not treat that partial index as the schema-level
-- `@unique`, so drop it and recreate a normal nullable unique index.
DROP INDEX IF EXISTS "RewardLedger_idempotency_key_key";
CREATE UNIQUE INDEX "RewardLedger_idempotency_key_key" ON "RewardLedger"("idempotency_key");

-- Verification SQL:
-- SELECT idempotency_key, COUNT(*)
-- FROM "RewardLedger"
-- WHERE idempotency_key IS NOT NULL
-- GROUP BY idempotency_key
-- HAVING COUNT(*) > 1;
-- Expected: 0 rows.

-- Rollback note: dropping "RewardLedger_idempotency_key_key" removes only the
-- uniqueness enforcement. Do not delete RewardLedger rows or mutate amount/direction
-- columns during rollback.
