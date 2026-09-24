// Mirrors backend/models/schemas.py — keep in sync by hand.
export type Role = "admin" | "kasir";

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
}

export interface UserCreate {
  username: string;
  full_name: string;
  role: Role;
  password: string;
}

export interface UserUpdate {
  full_name: string;
  role: Role;
  active: boolean;
  password: string | null;
}

export interface CategoryIn {
  name: string;
  description: string;
}

export interface Category extends CategoryIn {
  id: string;
  product_count: number;
}

export interface ProductIn {
  sku: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  unit: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock: number;
  supplier: string;
  photo_url: string;
  active: boolean;
}

export interface Product extends ProductIn {
  id: string;
  category_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockAdjustIn {
  product_id: string;
  type: "stock_in" | "stock_out" | "adjustment";
  qty: number;
  note: string;
}

export type PaymentMethod = "cash" | "qris" | "transfer" | "debit" | "kredit" | "ewallet";

export interface SaleItemIn {
  product_id: string;
  qty: number;
  discount: number;
}

export interface SaleIn {
  items: SaleItemIn[];
  discount_type: "nominal" | "percent";
  discount_value: number;
  payment_method: PaymentMethod;
  amount_paid: number;
}

export interface SaleItem {
  product_id: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  buy_price: number;
  discount: number;
  subtotal: number;
}

export interface Sale {
  id: string;
  invoice_no: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  amount_paid: number;
  change: number;
  cashier_name: string;
  status: "completed" | "void";
  void_reason: string | null;
  date: string;
  created_at: string;
}

export interface Settings {
  store_name: string;
  address: string;
  whatsapp: string;
  receipt_footer: string;
  paper_size: "58" | "80";
  tax_percent: number;
  currency: string;
  invoice_prefix: string;
  payment_methods: string[];
}

export interface ChartPoint {
  date: string;
  total: number;
  count: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
  unit: string;
}

export interface Dashboard {
  start: string;
  end: string;
  total_sales: number;
  transaction_count: number;
  items_sold: number;
  profit: number;
  low_stock: LowStockItem[];
  out_of_stock: LowStockItem[];
  recent_sales: Sale[];
  chart: ChartPoint[];
  payment_breakdown: Record<string, number>;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  error: string;
}
