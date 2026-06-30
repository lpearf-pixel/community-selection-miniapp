import { buildApp } from '../apps/api/src/app.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_TOKEN = 'test-admin-token';

const app = buildApp();

async function main() {
  const noToken = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts' });
  assert(noToken.statusCode === 401, `admin route without token should be 401, got ${noToken.statusCode}`);

  const wrongToken = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts', headers: { 'x-admin-token': 'wrong-token' } });
  assert(wrongToken.statusCode === 401, `admin route with wrong token should be 401, got ${wrongToken.statusCode}`);

  const rightToken = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts', headers: { 'x-admin-token': 'test-admin-token' } });
  const rightBody = rightToken.json() as { success: boolean };
  assert(rightToken.statusCode === 200, `admin route with right token should be 200, got ${rightToken.statusCode}`);
  assert(rightBody.success === true, 'admin route with right token should return success=true');

  const health = await app.inject({ method: 'GET', url: '/health' });
  const healthBody = health.json() as { success: boolean };
  assert(health.statusCode === 200, `health should be 200, got ${health.statusCode}`);
  assert(healthBody.success === true, 'health should remain public');

  console.log('L10 security verification passed.');
}

main();
