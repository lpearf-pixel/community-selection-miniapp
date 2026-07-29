import { config, validateRuntimeConfig } from '@community-selection/config';
import { buildApp } from './app.js';
import { startWechatCommerceScheduler } from './services/wechat-commerce-jobs.js';
import { startWechatShippingScheduler } from './services/wechat-shipping-jobs.js';

validateRuntimeConfig();
const app = buildApp();

await app.listen({ host: '0.0.0.0', port: config.port });
startWechatCommerceScheduler();
startWechatShippingScheduler();
