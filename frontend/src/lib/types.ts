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
  wholesale_tiers: WholesaleTier[];
  promo_price: number | null;
  promo_start: string | null;
  promo_end: string | null;
}

export interface WholesaleTier {
  min_qty: number;
  price: number;
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

export type PaymentMethod = "cash" | "qris" | "transfer" | "debit" | "kredit" | "ewallet" | "hutang";

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
  customer_id: string | null;
  due_date: string | null;
  redeem_points: number;
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
  normal_price: number;
  price_type: "normal" | "promo" | "grosir";
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
  customer_id: string | null;
  customer_name: string | null;
  points_earned: number;
  points_redeemed: number;
  points_discount: number;
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
  owner_whatsapp: string;
  expense_categories: string[];
  loyalty_enabled: boolean;
  points_per_amount: number;
  point_value: number;
  min_redeem_points: number;
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
  due_debts: DueDebt[];
}

export interface DueDebt {
  id: string;
  customer_id: string;
  customer_name: string;
  invoice_no: string;
  remaining: number;
  due_date: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  error: string;
}

// ---------- suppliers & purchases ----------
export interface SupplierIn {
  name: string;
  contact_name: string;
  phone: string;
  address: string;
  note: string;
}

export interface Supplier extends SupplierIn {
  id: string;
  purchase_count: number;
  purchase_total: number;
}

export interface PurchaseItemIn {
  product_id: string;
  qty: number;
  buy_price: number;
}

export interface PurchaseIn {
  supplier_id: string;
  invoice_no: string;
  date: string;
  items: PurchaseItemIn[];
  note: string;
  update_buy_price: boolean;
}

export interface PurchaseItem {
  product_id: string;
  name: string;
  unit: string;
  qty: number;
  buy_price: number;
  subtotal: number;
}

export interface Purchase {
  id: string;
  supplier_id: string;
  supplier_name: string;
  invoice_no: string;
  date: string;
  items: PurchaseItem[];
  total: number;
  note: string;
  username: string;
  created_at: string;
}

// ---------- returns ----------
export interface ReturnItemIn {
  product_id: string;
  qty: number;
}

export interface ReturnIn {
  type: "sale" | "purchase";
  ref_id: string;
  items: ReturnItemIn[];
  reason: string;
}

export interface ReturnItem {
  product_id: string;
  name: string;
  qty: number;
  price: number;
  subtotal: number;
}

export interface Return {
  id: string;
  return_no: string;
  type: "sale" | "purchase";
  ref_id: string;
  ref_no: string;
  items: ReturnItem[];
  total: number;
  reason: string;
  username: string;
  date: string;
  created_at: string;
}

// ---------- shifts ----------
export interface ShiftExpense {
  amount: number;
  note: string;
  created_at: string;
}

export interface ShiftSummary {
  transaction_count: number;
  total_sales: number;
  by_payment: Record<string, number>;
  expenses_total: number;
  refunds_cash: number;
  expected_cash: number;
}

export interface Shift {
  id: string;
  user_id: string;
  cashier_name: string;
  status: "open" | "closed";
  opening_cash: number;
  opened_at: string;
  closed_at: string | null;
  expenses: ShiftExpense[];
  summary: ShiftSummary | null;
  actual_cash: number | null;
  difference: number | null;
  note: string;
}

// ---------- reports ----------
export interface TopProduct {
  name: string;
  qty: number;
  omzet: number;
  profit: number;
}

export interface DailyReport {
  date: string;
  transaction_count: number;
  items_sold: number;
  omzet: number;
  discount: number;
  modal: number;
  profit: number;
  by_payment: Record<string, number>;
  void_count: number;
  sale_returns_total: number;
  top_products: TopProduct[];
  expenses_total: number;
  expenses_by_category: Record<string, number>;
  net_profit: number;
  debt_new: number;
  debt_collected: number;
}

export interface RestockItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
  suggested_qty: number;
  buy_price: number;
  estimated_cost: number;
}

export interface RestockGroup {
  supplier: string;
  items: RestockItem[];
  total_cost: number;
}

// ---------- customers, debts, expenses, archive ----------
export interface CustomerIn {
  name: string;
  whatsapp: string;
  address: string;
  note: string;
}

export interface Customer extends CustomerIn {
  id: string;
  points: number;
  debt_remaining: number;
  transaction_count: number;
}

export interface DebtPayment {
  amount: number;
  note: string;
  username: string;
  created_at: string;
}

export interface Debt {
  id: string;
  customer_id: string;
  customer_name: string;
  sale_id: string;
  invoice_no: string;
  total: number;
  paid: number;
  remaining: number;
  due_date: string | null;
  status: "open" | "paid";
  payments: DebtPayment[];
  created_at: string;
}

export interface ExpenseIn {
  category: string;
  amount: number;
  date: string;
  note: string;
}

export interface Expense extends ExpenseIn {
  id: string;
  username: string;
  created_at: string;
}

export interface DailyReportSnapshot {
  date: string;
  generated_at: string;
  source: "cron" | "manual";
  report: DailyReport;
}

export interface BackupInfo {
  id: string;
  filename: string;
  size: number;
  source: "manual" | "auto" | "pre-restore";
  collections: Record<string, number>;
  username: string;
  created_at: string;
}

export interface ImportRow {
  row: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock: number;
  status: "new" | "update" | "error";
  errors: string[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  new_categories: string[];
}

export interface MonthlyDay {
  date: string;
  omzet: number;
  modal: number;
  profit: number;
  expenses: number;
  net: number;
  transactions: number;
}

export interface MonthlyReport {
  month: string;
  days: MonthlyDay[];
  omzet: number;
  modal: number;
  profit: number;
  expenses: number;
  net: number;
  transactions: number;
}

// ---------- stock opname ----------
export interface OpnameItemIn {
  product_id: string;
  counted: number;
}

export interface OpnameIn {
  items: OpnameItemIn[];
  note: string;
}

export interface OpnameLine {
  product_id: string;
  sku: string;
  name: string;
  system_stock: number;
  counted: number;
  diff: number;
  value_diff: number;
}

export interface Opname {
  id: string;
  lines: OpnameLine[];
  adjusted_count: number;
  value_diff: number;
  note: string;
  username: string;
  created_at: string;
}
