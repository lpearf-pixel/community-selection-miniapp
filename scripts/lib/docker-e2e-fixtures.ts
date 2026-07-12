import type { PrismaClient } from '@prisma/client';

export const DOCKER_E2E_ADMIN_ID = 'docker-e2e-admin';

export async function ensureDockerE2eFixtures(prisma: PrismaClient) {
  await prisma.adminUser.upsert({
    where: { id: DOCKER_E2E_ADMIN_ID },
    update: { role: 'super_admin', status: 'active' },
    create: {
      id: DOCKER_E2E_ADMIN_ID,
      username: 'docker-e2e-admin-user',
      password_hash: 'docker-e2e-placeholder-not-for-login',
      role: 'super_admin',
      status: 'active'
    }
  });
}
