export type CommissionType = "none" | "fixed" | "percent";
export type ProductStatus = "draft" | "active" | "inactive";

export type Category = {
  id: string;
  name: string;
};

export type Product = {
  id: string;
  name: string;
  category_id: string;
  category?: Category;
  price_cents: number;
  cost_price_cents: number;
  stock: number;
  unit: string;
  stock_unit: string;
  sale_unit: string;
  sale_spec_name?: string | null;
  stock_deduct_quantity: number;
  is_group_enabled: boolean;
  commission_type: CommissionType;
  commission_value: number;
  status: ProductStatus;
};

export type CatalogProductsData = {
  categories: Category[];
  products: Product[];
};

export const EMPTY_PRODUCT: Product = {
  id: "",
  name: "",
  category_id: "",
  price_cents: 0,
  cost_price_cents: 0,
  stock: 0,
  unit: "份",
  stock_unit: "piece",
  sale_unit: "份",
  sale_spec_name: null,
  stock_deduct_quantity: 1,
  is_group_enabled: false,
  commission_type: "none",
  commission_value: 0,
  status: "draft",
};
