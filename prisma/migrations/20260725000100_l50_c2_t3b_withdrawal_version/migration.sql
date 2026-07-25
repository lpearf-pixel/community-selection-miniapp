-- L50-C2-T3-B: optimistic concurrency for reliable Admin withdrawal commands.
ALTER TABLE "Withdrawal"
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
