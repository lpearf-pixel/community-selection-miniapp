import { readFileSync } from 'node:fs';

type TsConfig = {
  compilerOptions?: {
    strict?: boolean;
    noImplicitAny?: boolean;
    skipLibCheck?: boolean;
    jsx?: string;
  };
};

const config = JSON.parse(readFileSync('apps/admin/tsconfig.json', 'utf8')) as TsConfig;
const options = config.compilerOptions ?? {};
const errors: string[] = [];

if (options.strict !== true) errors.push('apps/admin/tsconfig.json compilerOptions.strict must be true.');
if (options.noImplicitAny === false) errors.push('apps/admin/tsconfig.json compilerOptions.noImplicitAny must not be false.');
if (options.skipLibCheck !== true) errors.push('apps/admin/tsconfig.json compilerOptions.skipLibCheck must be true to isolate third-party declaration internals.');
if (options.jsx !== 'react-jsx') errors.push('apps/admin/tsconfig.json compilerOptions.jsx must be react-jsx.');

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Admin typecheck config verified: strict=true, noImplicitAny is not false, skipLibCheck=true, jsx=react-jsx.');
console.log('Third-party declaration internals are excluded by skipLibCheck; project strict mode remains enabled.');
