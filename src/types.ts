// =====================================================================
// Tipos de dominio — espejo del esquema supabase/schema.sql
// =====================================================================

export type UserRole = 'admin' | 'cajero' | 'carnicero';
export type Species = 'res' | 'cerdo' | 'cordero' | 'pollo' | 'otro';
export type CarcassStatus = 'recibida' | 'en_despiece' | 'despiezada' | 'anulada';
export type CarcassType = 'entera' | 'media' | 'cuarto_delantero' | 'cuarto_trasero';
export type LotStatus = 'activo' | 'agotado' | 'vencido' | 'bloqueado';
export type SaleStatus = 'completada' | 'anulada';
export type PaymentMethod = 'efectivo' | 'yape' | 'plin' | 'tarjeta' | 'credito';
export type LedgerType = 'cargo' | 'abono' | 'ajuste';
export type WeightSource = 'manual' | 'scale' | 'shortcut';

export interface BusinessSettings {
  id: 1;
  trade_name: string;
  legal_name: string | null;
  tax_id: string | null;
  tax_id_label: string;
  currency_code: string;
  currency_symbol: string;
  tax_name: string;
  tax_rate: number;
  prices_include_tax: boolean;
  address: string | null;
  phone: string | null;
  ticket_footer: string | null;
  yape_qr_path: string | null;
  yape_holder: string | null;
  yape_phone: string | null;
  plin_qr_path: string | null;
  plin_holder: string | null;
  plin_phone: string | null;
  allow_negative_stock: boolean;
  default_credit_days: number;
  whatsapp_webhook_url: string | null;
  /** Rebaja máxima (%) sobre precio de catálogo que puede aplicar un no-admin. */
  max_discount_pct: number;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  terminal_id: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  species: Species | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
}

export interface Product {
  id: string;
  category_id: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  sell_by_weight: boolean;
  unit: 'kg' | 'und';
  price_per_unit: number;
  cost_per_unit: number;
  stock_actual_kg: number;
  min_stock_kg: number;
  value_factor: number;
  is_commercial_cut: boolean;
  weight_shortcuts: number[];
  image_url: string | null;
  active: boolean;
  updated_at: string;
}

export interface CutType {
  id: string;
  name: string;
  shrink_pct: number;
  surcharge_per_kg: number;
  active: boolean;
  sort_order: number;
}

export interface Carcass {
  id: string;
  code: string;
  species: Species;
  carcass_type: CarcassType;
  supplier_name: string;
  supplier_tax_id: string | null;
  truck_plate: string | null;
  guide_number: string | null;
  senasa_code: string | null;
  slaughter_date: string;
  received_at: string;
  arrival_temp_c: number | null;
  hook_weight_kg: number;
  total_cost: number;
  shelf_life_days: number;
  status: CarcassStatus;
  yield_pct: number | null;
  commercial_kg: number | null;
  byproduct_kg: number | null;
  loss_kg: number | null;
  processed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface CutYieldRow {
  id?: string;
  carcass_id: string;
  product_id: string;
  kg_obtained: number;
  is_commercial: boolean;
  value_factor: number;
  allocated_cost?: number | null;
  cost_per_kg?: number | null;
  lot_id?: string | null;
}

export interface InventoryLot {
  id: string;
  lot_number: string;
  product_id: string;
  carcass_id: string | null;
  supplier_name: string | null;
  senasa_registry: string | null;
  slaughter_date: string | null;
  expiry_date: string | null;
  received_at: string;
  storage_temp_c: number | null;
  initial_kg: number;
  remaining_kg: number;
  unit_cost: number;
  status: LotStatus;
}

export interface LotTraceability {
  lot_id: string;
  lot_number: string;
  product_name: string;
  initial_kg: number;
  remaining_kg: number;
  unit_cost: number;
  status: LotStatus;
  expiry_date: string | null;
  slaughter_date: string | null;
  senasa_registry: string | null;
  supplier_name: string | null;
  carcass_code: string | null;
  truck_plate: string | null;
  guide_number: string | null;
  arrival_temp_c: number | null;
  sold_kg: number;
}

export interface Customer {
  id: string;
  doc_type: 'DNI' | 'RUC' | 'CE' | 'OTRO';
  doc_number: string | null;
  full_name: string;
  phone: string | null;
  address: string | null;
  credit_enabled: boolean;
  credit_limit: number;
  credit_days: number;
  balance: number;
  oldest_due_date: string | null;
  active: boolean;
}

export interface LedgerEntry {
  id: string;
  customer_id: string;
  sale_id: string | null;
  payment_id: string | null;
  entry_type: LedgerType;
  amount: number;
  due_date: string | null;
  note: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  client_uuid: string;
  sale_number: number;
  customer_id: string | null;
  cashier_id: string;
  terminal_id: string | null;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total: number;
  status: SaleStatus;
  created_at: string;
}

export interface DailySales {
  day: string;
  tickets: number;
  total: number;
  cost: number;
}

export interface CarcassYieldView {
  id: string;
  code: string;
  species: Species;
  supplier_name: string;
  slaughter_date: string;
  hook_weight_kg: number;
  total_cost: number;
  commercial_kg: number | null;
  byproduct_kg: number | null;
  loss_kg: number | null;
  yield_pct: number | null;
  status: CarcassStatus;
  processed_at: string | null;
  real_cost_per_commercial_kg: number | null;
}

// ---------------------------------------------------------------------
// Caja (turnos y arqueo)
// ---------------------------------------------------------------------
export type CashSessionStatus = 'abierta' | 'cerrada';
export type CashMovementKind = 'ingreso' | 'egreso';

export interface CashSession {
  id: string;
  terminal_id: string;
  status: CashSessionStatus;
  opened_by: string;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  summary: CashSummary | null;
  notes: string | null;
}

export interface CashMovement {
  id: string;
  session_id: string;
  kind: CashMovementKind;
  amount: number;
  reason: string;
  created_by: string | null;
  created_at: string;
}

/** Resultado de la RPC cash_session_summary (y foto guardada al cerrar). */
export interface CashSummary {
  session_id: string;
  terminal_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  sales_by_method: Partial<Record<PaymentMethod, number>>;
  abonos_by_method: Partial<Record<PaymentMethod, number>>;
  sales_count: number;
  sales_total: number;
  voided_count: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash?: number;
  difference?: number;
}

// ---------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------
export interface CartLine {
  key: string;                 // id local de la línea
  product_id: string;
  product_name: string;
  unit: 'kg' | 'und';
  quantity: number;            // kg netos o unidades
  unit_price: number;
  cut_type_id: string | null;
  cut_type_name: string | null;
  shrink_pct: number;
  surcharge_per_kg: number;
  lot_id: string | null;
  weight_source: WeightSource;
}

export interface PaymentDraft {
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  operation_number?: string;
}

export interface SalePayload {
  client_uuid: string;
  customer_id: string | null;
  terminal_id: string;
  discount: number;
  offline_created_at: string | null;
  items: Array<{
    product_id: string;
    lot_id: string | null;
    cut_type_id: string | null;
    quantity: number;
    unit_price: number;
    weight_source: WeightSource;
  }>;
  payments: PaymentDraft[];
}

export interface CreateSaleResult {
  sale_id: string;
  sale_number: number;
  subtotal?: number;
  tax?: number;
  total: number;
  change?: number;
  duplicate: boolean;
}

// ---------------------------------------------------------------------
// Offline outbox
// ---------------------------------------------------------------------
export type OutboxKind = 'sale' | 'customer_payment';
export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'done';

export interface OutboxEntry {
  id: string;                  // = client_uuid para ventas
  kind: OutboxKind;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  synced_at: string | null;
  result: unknown;
}

// ---------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------
export type ScaleTransport = 'serial' | 'bluetooth';
export type ScaleProtocol = 'continuous' | 'request';

export interface ScaleConfig {
  transport: ScaleTransport;
  protocol: ScaleProtocol;       // continuo (CAS, Systel) o por comando (Toledo, Torrey)
  baudRate: number;
  dataBits: 7 | 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1 | 2;
  requestCommand: string;        // ej. "P", "W", "\x05" (ENQ)
  pollIntervalMs: number;
  stableReadings: number;        // lecturas iguales consecutivas para marcar estable
  stableToleranceKg: number;
  unitDivisor: number;           // 1 si la balanza envía kg; 1000 si envía gramos
}

export interface ScaleReading {
  weightKg: number;
  stable: boolean;
  raw: string;
  at: number;
}

export type ScaleStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PrinterConfig {
  paperWidthChars: 32 | 42 | 48;  // 58mm = 32, 80mm = 42/48
  openCashDrawer: boolean;
  copies: number;
}
