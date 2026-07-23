import { createJsonRequester } from './client';

const adminApiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? '';

export const adminJsonRequest = createJsonRequester({
  baseUrl: adminApiBaseUrl,
});

export function adminApiUrl(path: string): string {
  return `${adminApiBaseUrl}${path}`;
}
