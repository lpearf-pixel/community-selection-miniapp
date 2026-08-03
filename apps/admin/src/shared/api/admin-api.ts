import { createJsonRequester } from './client';
import { demoAdminAuthHeaders } from './demo-admin-auth';

const adminApiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? '';

export const adminJsonRequest = createJsonRequester({
  baseUrl: adminApiBaseUrl,
  getDefaultHeaders: () =>
    demoAdminAuthHeaders({
      dev: import.meta.env.DEV === true,
      token: import.meta.env.VITE_ADMIN_TOKEN,
    }),
});

export function adminApiUrl(path: string): string {
  return `${adminApiBaseUrl}${path}`;
}
