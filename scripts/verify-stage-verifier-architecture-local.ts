import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('scripts').filter((file) =>
  /^verify-l(2[4-9]|3\d|4[0-8]).*-local\.ts$/.test(file),
);

const forbidden = [
  /stageWorkflow\.includes/i,
  /workflow\.includes\([^)]*verify-l/i,
  /verifyAll\.includes/i,
  /must be registered in stage workflow/i,
  /missing pnpm exec tsx scripts\/verify-l/i,
];

for (const file of files) {
  const source = readFileSync(`scripts/${file}`, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`${file} retains source-layout registration assertion`);
    }
  }
}

console.log('Stage verifier architecture checks passed.');
