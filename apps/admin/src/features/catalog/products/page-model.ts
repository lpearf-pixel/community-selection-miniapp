import type { Category, Product } from "./types";

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
