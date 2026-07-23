import { describe, expect, it } from "vitest";
import {
  catalogCategoryOptions,
  reduceCatalogProductsResource,
  toggleCatalogProductStatus,
} from "./page-model";
import type { FeatureResourceState } from "../../../shared/state/feature-resource";
import { EMPTY_PRODUCT, type CatalogProductsData } from "./types";

describe("catalog product page model", () => {
  it("maps categories to the existing select options", () => {
    expect(catalogCategoryOptions([{ id: "c1", name: "蔬菜" }])).toEqual([
      { label: "蔬菜", value: "c1" },
    ]);
  });

  it("toggles only the selected product between active and inactive", () => {
    const products = [
      { ...EMPTY_PRODUCT, id: "p1", status: "active" as const },
      { ...EMPTY_PRODUCT, id: "p2", status: "draft" as const },
    ];

    const result = toggleCatalogProductStatus(products, "p1");

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "p1", status: "inactive" },
      { id: "p2", status: "draft" },
    ]);
  });

  it.each([
    ["refreshing", null],
    ["error", "目录刷新失败"],
  ] as const)(
    "preserves %s request state when a product is toggled locally",
    (status, error) => {
      const state: FeatureResourceState<CatalogProductsData> = {
        status,
        error,
        data: {
          categories: [],
          products: [
            { ...EMPTY_PRODUCT, id: "p1", status: "active" },
          ],
        },
      };

      const result = reduceCatalogProductsResource(state, {
        type: "product-status-toggled",
        productId: "p1",
      });

      expect(result.status).toBe(status);
      expect(result.error).toBe(error);
      expect(result.data?.products[0]?.status).toBe("inactive");
    },
  );
});
