export type AdminScopeSummary = {
  label: string;
  hasConfiguredScope: boolean;
  pickupStoreId: string;
  communityId: string;
};

export const ADMIN_PICKUP_STORE_ID = "ADMIN_PICKUP_STORE_ID";
export const ADMIN_COMMUNITY_ID = "ADMIN_COMMUNITY_ID";

function readLocalStorage(key: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key)?.trim() ?? "";
}

export function getAdminScopeHeaders(): Record<string, string> {
  const pickupStoreId = readLocalStorage(ADMIN_PICKUP_STORE_ID);
  const communityId = readLocalStorage(ADMIN_COMMUNITY_ID);
  return {
    ...(pickupStoreId ? { "x-admin-pickup-store-id": pickupStoreId } : {}),
    ...(communityId ? { "x-admin-community-id": communityId } : {}),
  };
}

export function getAdminScopeSummary(): AdminScopeSummary {
  const pickupStoreId = readLocalStorage(ADMIN_PICKUP_STORE_ID);
  const communityId = readLocalStorage(ADMIN_COMMUNITY_ID);
  const parts = [pickupStoreId ? `指定自提点：${pickupStoreId}` : "", communityId ? `指定社区：${communityId}` : ""].filter(Boolean);
  return { pickupStoreId, communityId, hasConfiguredScope: parts.length > 0, label: parts.length > 0 ? parts.join(" / ") : "全部" };
}
