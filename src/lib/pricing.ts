// =====================================================================
// Motor de precios del POS — funciones puras (mismo algoritmo que create_sale en SQL)
// =====================================================================
import type { CartLine, PaymentDraft } from '@/types';
import { round } from './utils';

/** kg brutos que salen del stock para entregar `netKg` con una merma de preparación `shrinkPct`. */
export function grossKgForNet(netKg: number, shrinkPct: number): number {
  if (shrinkPct <= 0) return round(netKg, 3);
  return round(netKg / (1 - shrinkPct / 100), 3);
}

export function shrinkKg(netKg: number, shrinkPct: number): number {
  return round(grossKgForNet(netKg, shrinkPct) - netKg, 3);
}

export function lineTotal(line: Pick<CartLine, 'quantity' | 'unit_price' | 'surcharge_per_kg'>): number {
  return round(round(line.quantity * line.unit_price, 2) + round(line.surcharge_per_kg * line.quantity, 2), 2);
}

export interface TicketTotals {
  gross: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export function computeTotals(
  lines: CartLine[],
  discount: number,
  taxRate: number,
  pricesIncludeTax: boolean,
): TicketTotals {
  const gross = round(lines.reduce((acc, l) => acc + lineTotal(l), 0), 2);
  const base = Math.max(round(gross - discount, 2), 0);
  if (pricesIncludeTax) {
    const subtotal = round(base / (1 + taxRate / 100), 2);
    return { gross, discount, subtotal, tax: round(base - subtotal, 2), total: base };
  }
  const tax = round(base * (taxRate / 100), 2);
  return { gross, discount, subtotal: base, tax, total: round(base + tax, 2) };
}

export function paymentSummary(total: number, payments: PaymentDraft[]) {
  const paid = round(payments.reduce((a, p) => a + (p.amount || 0), 0), 2);
  const remaining = Math.max(round(total - paid, 2), 0);
  const cashTendered = payments
    .filter((p) => p.method === 'efectivo')
    .reduce((a, p) => a + (p.tendered ?? p.amount), 0);
  const cashAmount = payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0);
  const change = Math.max(round(cashTendered - cashAmount, 2), 0);
  return { paid, remaining, change, complete: paid >= total && total > 0 };
}

/** Validaciones de negocio antes de cobrar (el servidor vuelve a validar). */
export function validatePayments(total: number, payments: PaymentDraft[], hasCustomer: boolean): string | null {
  const { paid } = paymentSummary(total, payments);
  if (paid < total) return 'El pago no cubre el total.';
  for (const p of payments) {
    if (p.amount <= 0) continue;
    if ((p.method === 'yape' || p.method === 'plin') && (p.operation_number ?? '').trim().length < 4) {
      return `Ingrese el número de operación de ${p.method === 'yape' ? 'Yape' : 'Plin'} (mín. 4 dígitos).`;
    }
    if (p.method === 'credito' && !hasCustomer) return 'La venta al crédito requiere seleccionar un cliente.';
    if (p.method === 'efectivo' && p.tendered !== undefined && p.tendered < p.amount) {
      return 'El efectivo recibido es menor al monto asignado.';
    }
  }
  const nonCash = payments.filter((p) => p.method !== 'efectivo').reduce((a, p) => a + p.amount, 0);
  if (round(nonCash, 2) > total) return 'Los pagos electrónicos/crédito no pueden exceder el total (no dan vuelto).';
  return null;
}

/** Descuento máximo (monto) que puede aplicar un no-admin: mismo tope que valida create_sale. */
export function maxDiscountAmount(gross: number, maxPct: number | null | undefined): number {
  // Configuración cacheada de antes de la migración: sin tope en el cliente (el servidor decide)
  if (maxPct === null || maxPct === undefined || !Number.isFinite(maxPct)) return gross;
  return round(gross * (Math.min(Math.max(maxPct, 0), 100) / 100), 2);
}

export function validateDiscount(gross: number, discount: number, maxPct: number | null | undefined, isAdmin: boolean): string | null {
  if (discount < 0) return 'El descuento no puede ser negativo.';
  if (isAdmin) return null;
  const max = maxDiscountAmount(gross, maxPct);
  if (discount > max + 0.005) {
    return `El descuento supera el máximo permitido (${maxPct}% = ${max.toFixed(2)}). Requiere un administrador.`;
  }
  return null;
}
