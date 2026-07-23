import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../../apps/api/src/db.js';
import { hashPassword } from '../../apps/api/src/services/admin-auth-service.js';

const username = 'l50_e2e_admin';
const password = 'L50-E2E-StrongPassword-123';
const fixturePath = resolve('scripts/admin-e2e/.fixture.json');

async function cleanup() {
  const users = await prisma.adminUser.findMany({ where: { username }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (ids.length) {
    await prisma.adminSession.deleteMany({ where: { admin_user_id: { in: ids } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
  }
  await rm(fixturePath, { force: true });
}

async function setup() {
  await cleanup();
  await prisma.adminUser.create({
    data: {
      username,
      password_hash: await hashPassword(password),
      role: 'admin',
      totp_enabled: false,
    },
  });
  await writeFile(fixturePath, JSON.stringify({ username, password }), { mode: 0o600 });
}

const action = process.argv[2];
if (action === 'setup') await setup();
else if (action === 'cleanup') await cleanup();
else throw new Error('usage: fixture.ts <setup|cleanup>');

await prisma.$disconnect();
