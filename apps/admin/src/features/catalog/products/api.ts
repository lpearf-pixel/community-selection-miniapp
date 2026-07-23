import { adminJsonRequest } from "../../../shared/api/admin-api";
import type { JsonRequester } from "../../../shared/api/client";
import type { CatalogProductsData, Category, Product } from "./types";

export async function loadCatalogProducts(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<CatalogProductsData> {
  const [categories, products] = await Promise.all([
    request<Category[]>("/api/categories", { signal }),
    request<{ items: Product[] }>("/api/products", { signal }),
  ]);

  return {
    categories,
    products: products.items,
  };
}
