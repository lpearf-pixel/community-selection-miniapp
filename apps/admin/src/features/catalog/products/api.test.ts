import { describe, expect, it, vi } from "vitest";
import type { JsonRequester } from "../../../shared/api/client";
import { loadCatalogProducts } from "./api";

describe("catalog products loader", () => {
  it("loads the existing category and product endpoints", async () => {
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      const value = path === "/api/categories"
        ? [{ id: "category-1", name: "蔬菜" }]
        : { items: [{ id: "product-1", name: "青菜" }] };
      return value as T;
    }) as JsonRequester;

    const result = await loadCatalogProducts(request);

    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
      "/api/categories",
      "/api/products",
    ]);
    expect(result.categories).toEqual([{ id: "category-1", name: "蔬菜" }]);
    expect(result.products).toEqual([{ id: "product-1", name: "青菜" }]);
  });
});
