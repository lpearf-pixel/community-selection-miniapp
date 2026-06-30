import type { AdminUser } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

export {};
