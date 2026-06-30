import { readFileSync } from 'node:fs';

const seed = readFileSync('prisma/seed.ts', 'utf8');
const blocked = [/id_card/i, /bank_card/i, /account_no/i, /private_key/i, /certificate/i, /token\s*[:=]/i];
const matches = blocked.filter((pattern) => pattern.test(seed));
if (matches.length > 0) {
  console.error('Seed data check failed: sensitive fields or credentials found.');
  for (const pattern of matches) console.error(`- ${pattern}`);
  process.exit(1);
}
console.log('Seed data check passed.');
