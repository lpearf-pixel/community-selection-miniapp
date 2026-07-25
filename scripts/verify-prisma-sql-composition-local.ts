import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return files(join(dir, entry.name));
    if (!entry.name.endsWith('.ts')) return [];
    if (/\.(?:test|spec)\.ts$/.test(entry.name)) return [];
    return [join(dir, entry.name)];
  });
}

const entries = ['apps', 'packages']
  .flatMap(files)
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }));

for (const { file, source } of entries) {
  if (/Prisma\.join\([\s\S]{0,1500}?,\s*Prisma\.sql`/.test(source)) {
    throw new Error(`${file}: Prisma.join separator must be a string`);
  }
  if (
    source.includes('$queryRawUnsafe') ||
    source.includes('$executeRawUnsafe')
  ) {
    throw new Error(`${file}: unsafe raw SQL is forbidden`);
  }
  if (source.includes('[object Object]')) {
    throw new Error(`${file}: object SQL composition marker found`);
  }
}

const tax =
  entries.find((entry) =>
    entry.file.endsWith('tax-record-scope-repository.ts'),
  )?.source ?? '';
for (const marker of [
  "], ' OR ');",
  "Prisma.join(parts, ' AND ')",
  'escapeLikePattern',
  'Prisma.sql`FALSE`',
]) {
  if (!tax.includes(marker)) {
    throw new Error(`TaxRecord SQL composition missing ${marker}`);
  }
}

console.log('Prisma SQL composition checks passed.');
