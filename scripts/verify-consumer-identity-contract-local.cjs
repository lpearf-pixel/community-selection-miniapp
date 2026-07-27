#!/usr/bin/env node

const {
  activeVerifierFiles,
  findConsumerIdentityViolations,
} = require('./verification-contract/consumer-identity-contract.cjs');

const files = activeVerifierFiles(process.cwd());
const violations = findConsumerIdentityViolations(process.cwd(), files);

if (violations.length > 0) {
  console.error('identity.consumer.v2 verifier migration failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `identity.consumer.v2 verifier migration passed (${files.length} active verifiers scanned).`,
  );
}

