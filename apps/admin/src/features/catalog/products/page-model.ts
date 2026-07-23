import {
  reduceFeatureResource,
  type FeatureResourceAction,
  type FeatureResourceState,
} from "../../../shared/state/feature-resource";
import type {
  CatalogProductsData,
  Category,
  Product,
} from "./types";

export type CatalogProductsResourceAction =
  | FeatureResourceAction<CatalogProductsData>
  | { type: "product-status-toggled"; productId: string };

export function catalogCategoryOptions(categories: Category[]) {
  return categories.map((category) => ({
    label: category.name,
    value: category.id,
  }));
}

export function toggleCatalogProductStatus(
  products: readonly Product[],
  productId: string,
): Product[] {
  return products.map((product) =>
    product.id === productId
      ? {
          ...product,
          status: product.status === "active" ? "inactive" : "active",
        }
      : product,
  );
}

export function reduceCatalogProductsResource(
  state: FeatureResourceState<CatalogProductsData>,
  action: CatalogProductsResourceAction,
): FeatureResourceState<CatalogProductsData> {
  if (action.type !== "product-status-toggled") {
    return reduceFeatureResource(state, action);
  }
  if (state.data === null) return state;

  return {
    ...state,
    data: {
      ...state.data,
      products: toggleCatalogProductStatus(
        state.data.products,
        action.productId,
      ),
    },
  };
}
