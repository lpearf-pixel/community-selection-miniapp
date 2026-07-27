import { validateRuntimeConfig } from '../packages/config/src/index.js';

try {
  validateRuntimeConfig(process.env);
  const payMode =
    process.env.MOCK_WECHAT_PAY !== 'false' &&
    process.env.WECHAT_PAY_MODE !== 'wechat'
      ? 'mock'
      : 'wechat';
  console.log(
    `Environment validation passed for ${process.env.NODE_ENV ?? 'development'}, payment mode: ${payMode}.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Environment validation failed',
  );
  process.exitCode = 1;
}
