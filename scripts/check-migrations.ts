import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationDir = join(process.cwd(), 'prisma', 'migrations');
const entries = readdirSync(migrationDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const problems: string[] = [];
const seen = new Set<string>();

for (const entry of entries) {
  if (seen.has(entry)) problems.push(`Duplicate migration directory: ${entry}`);
  seen.add(entry);
  const sqlPath = join(migrationDir, entry, 'migration.sql');
  const sql = readFileSync(sqlPath, 'utf8').trim();
  if (!sql) problems.push(`Empty migration: ${entry}`);
  if (/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(sql)) problems.push(`Unsafe DROP TABLE without IF EXISTS in ${entry}`);
}

if (entries.length === 0) problems.push('No Prisma migrations found');
if (problems.length > 0) {
  console.error('Migration check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`Migration check passed. ${entries.length} migrations found.`);
