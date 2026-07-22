import { appConfig } from '@community-selection/config';
import { buildApp } from './app.js';

const app = buildApp();

await app.listen({ port: appConfig.api.port, host: appConfig.api.host });
