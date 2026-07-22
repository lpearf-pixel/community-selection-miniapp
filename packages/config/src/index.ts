export const appConfig = {
  api: {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0'
  },
  databaseUrl: process.env.DATABASE_URL ?? ''
} as const;
