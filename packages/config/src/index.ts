export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  mockWechatPay: process.env.MOCK_WECHAT_PAY !== 'false'
} as const;
