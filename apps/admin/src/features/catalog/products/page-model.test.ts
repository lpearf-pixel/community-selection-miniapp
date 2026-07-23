import { describe, expect, it } from "vitest";
import {
  catalogCategoryOptions,
  toggleCatalogProductStatus,
} from "./page-model";
import { EMPTY_PRODUCT } from "./types";

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
});
