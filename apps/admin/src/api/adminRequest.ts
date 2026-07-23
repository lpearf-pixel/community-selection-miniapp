import { getAdminScopeHeaders } from "../access/adminAccess";
import {
  createJsonRequester,
  type JsonRequestOptions,
} from "../shared/api/client";

export const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

function isAdminMockHeadersEnabled(): boolean {
  return import.meta.env?.DEV === true || import.meta.env?.VITE_ADMIN_MOCK_HEADERS === "true";
}

function readDevHeader(name: string, fallback = ""): string {
  if (!isAdminMockHeadersEnabled() || typeof window === "undefined") return "";
  const value = window.localStorage.getItem(name)?.trim();
  return value || fallback;
}

export function getAdminRequestHeaders(json = true): Record<string, string> {
  const devUserId = readDevHeader("ADMIN_USER_ID", "admin-dev");
  const devRole = readDevHeader("ADMIN_ROLE", "finance");
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(devUserId ? { "x-admin-user-id": devUserId } : {}),
    ...(devRole ? { "x-admin-role": devRole } : {}),
    ...(isAdminMockHeadersEnabled() ? getAdminScopeHeaders() : {}),
  };
}

export async function adminFetch(path: string, init?: RequestInit & { json?: boolean }) {
  const { json = true, headers, ...rest } = init ?? {};
  return fetch(`${apiBaseUrl}${path}`, {
    ...rest,
    credentials: "include",
    headers: { ...getAdminRequestHeaders(json), ...(headers ?? {}) },
  });
}

const requestJson = createJsonRequester({
  baseUrl: apiBaseUrl,
  getDefaultHeaders: () => getAdminRequestHeaders(false),
});

export function requestAdminJson<T>(path: string, init?: JsonRequestOptions): Promise<T> {
  return requestJson<T>(path, init);
}
