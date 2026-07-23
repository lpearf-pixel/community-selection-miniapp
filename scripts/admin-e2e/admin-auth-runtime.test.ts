import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../../apps/api/src/services/admin-auth-service.js';

test('hashes and verifies an admin password under Node ESM', async () => {
  const password = 'L50-E2E-StrongPassword-123';
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(`${password}-wrong`, hash), false);
});
