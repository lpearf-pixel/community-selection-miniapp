const { existsSync, readFileSync } = require('node:fs');
const { join, relative } = require('node:path');

const PROTECTED_ENDPOINTS = new Set([
  '/api/me/center-summary',
  '/api/leaders/me/center-summary',
  '/api/orders',
  '/api/orders/normal',
  '/api/payments/mock',
]);
const VERIFIER_PATTERN = /scripts\/(?:run-|verify-)[A-Za-z0-9.-]+\.ts/g;
const CALL_PATTERN = /\b(injectAsConsumer|requestData|(?:app\.)?inject|post)\s*\(/g;

function normalized(path) {
  return path.replaceAll('\\', '/');
}

function verifierPathsIn(source) {
  return source.match(VERIFIER_PATTERN) ?? [];
}

function activeVerifierFiles(root, stageVerifierFiles) {
  const verifyAllPath = join(root, 'scripts/verify-all-local.sh');
  const verifyAll = readFileSync(verifyAllPath, 'utf8');
  const stageFiles =
    stageVerifierFiles ??
    verifierPathsIn(
      readFileSync(join(root, 'scripts/stage-registry.ts'), 'utf8'),
    );

  return [
    ...new Set([...verifierPathsIn(verifyAll), ...stageFiles]),
  ]
    .filter((file) => existsSync(join(root, file)))
    .sort();
}

function matchingParen(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length - 1;
}

function protectedEndpoint(callSource) {
  for (const endpoint of PROTECTED_ENDPOINTS) {
    const literal = new RegExp(`['"]${endpoint.replaceAll('/', '\\/')}['"]`);
    if (literal.test(callSource)) return endpoint;
  }
  return undefined;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function callsIn(source) {
  const calls = [];
  for (const match of source.matchAll(CALL_PATTERN)) {
    const start = match.index;
    const openIndex = source.indexOf('(', start);
    const end = matchingParen(source, openIndex);
    calls.push({
      kind: match[1],
      start,
      source: source.slice(start, end + 1),
    });
  }
  return calls;
}

function findConsumerIdentityViolations(root, files) {
  const violations = [];

  for (const file of files) {
    const absolutePath = join(root, file);
    const source = readFileSync(absolutePath, 'utf8');
    for (const call of callsIn(source)) {
      const endpoint = protectedEndpoint(call.source);
      if (!endpoint) continue;

      const location = `${normalized(relative(root, absolutePath))}:${lineAt(source, call.start)}`;
      if (/\b(?:user_id|user_openid)\s*:/.test(call.source)) {
        violations.push(
          `${location}: ${endpoint} payload must not contain user_id or user_openid`,
        );
        continue;
      }
      if (
        call.kind !== 'injectAsConsumer' &&
        !/['"]x-user-id['"]\s*:/.test(call.source) &&
        !(call.kind === 'requestData' && /\buserId\s*:/.test(call.source))
      ) {
        violations.push(
          `${location}: ${endpoint} is missing consumer verifier identity`,
        );
      }
    }
  }
  return violations;
}

module.exports = {
  activeVerifierFiles,
  findConsumerIdentityViolations,
};
