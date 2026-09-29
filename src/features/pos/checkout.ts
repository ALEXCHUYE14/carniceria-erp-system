// =====================================================================
// Checkout: arma el payload, lo envía (o encola offline), imprime ticket
// =====================================================================
import type { QueryClient } from '@tanstack/react-query';
import { submitSale } from '@/lib/offline/sync';
import { db } from '@/lib/offline/db';
import { computeTotals, lineTotal, paymentSummary, shrinkKg } from '@/lib/pricing';
import { buildSaleTicket, printBytes, type TicketData } from '@/lib/hardware/escpos';
import { round, uuid } from '@/lib/utils';
import { queryKeys } from '@/hooks/useCatalog';
import type { BusinessSettings, CartLine, CreateSaleResult, PaymentDraft, PrinterConfig, Product, SalePayload } from '@/types';

export const METHOD_LABEL: Record<PaymentDraft['method'], string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  credito: 'Crédito (fiado)',
};

export interface CheckoutInput {
  lines: CartLine[];
  payments: PaymentDraft[];
  discount: number;
  customer: { id: string; full_name: string } | null;
  terminalId: string;
  settings: BusinessSettings;
}

export interface CheckoutOutcome {
  synced: boolean;
  offline: boolean;
  error?: string;
  result?: CreateSaleResult;
  ticket: TicketData;
  clientUuid: string;
}

export async function performCheckout(input: CheckoutInput, cashierName: string, qc: QueryClient): Promise<CheckoutOutcome> {
  const clientUuid = uuid();
  const payload: SalePayload = {
    client_uuid: clientUuid,
    customer_id: input.customer?.id ?? null,
    terminal_id: input.terminalId,
    discount: input.discount,
    offline_created_at: navigator.onLine ? null : new Date().toISOString(),
    items: input.lines.map((l) => ({
      product_id: l.product_id,
      lot_id: l.lot_id,
      cut_type_id: l.cut_type_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      weight_source: l.weight_source,
    })),
    // Efectivo: se registra solo el monto aplicado; el vuelto se calcula con `tendered`
    payments: input.payments
      .filter((p) => p.amount > 0)
      .map((p) => ({ ...p, amount: round(p.amount, 2), operation_number: p.operation_number?.trim() || undefined })),
  };

  const outcome = await submitSale(payload);

  // Descuento optimista de stock local para que las demás ventas offline vean el stock real
  if (!outcome.error) {
    const deltas = new Map<string, number>();
    for (const l of input.lines) {
      deltas.set(l.product_id, (deltas.get(l.product_id) ?? 0) + l.quantity + shrinkKg(l.quantity, l.shrink_pct));
    }
    await db.transaction('rw', db.products, async () => {
      for (const [id, kg] of deltas) {
        const p = await db.products.get(id);
        if (p) await db.products.update(id, { stock_actual_kg: round(Number(p.stock_actual_kg) - kg, 3) });
      }
    });
    qc.setQueryData<Product[]>(queryKeys.products, (old) =>
      old?.map((p) => (deltas.has(p.id) ? { ...p, stock_actual_kg: round(p.stock_actual_kg - (deltas.get(p.id) ?? 0), 3) } : p)),
    );
    void qc.invalidateQueries({ queryKey: queryKeys.customers });
    void qc.invalidateQueries({ queryKey: ['lots'] });
    void qc.invalidateQueries({ queryKey: ['sales'] });
  }

  const totals = computeTotals(input.lines, input.discount, input.settings.tax_rate, input.settings.prices_include_tax);
  const { change } = paymentSummary(totals.total, input.payments);

  const ticket: TicketData = {
    business: input.settings,
    saleNumber: outcome.result?.sale_number ?? `OFF-${clientUuid.slice(0, 8).toUpperCase()}`,
    date: new Date(),
    cashier: cashierName,
    terminal: input.terminalId,
    customer: input.customer?.full_name ?? null,
    lines: input.lines.map((l) => ({
      name: l.product_name,
      qty: l.unit === 'kg' ? `${l.quantity.toFixed(3)}kg` : `${l.quantity}und`,
      unitPrice: l.unit_price,
      total: lineTotal(l),
      detail: l.cut_type_name ? `Corte: ${l.cut_type_name}` : null,
    })),
    subtotal: totals.subtotal,
    tax: totals.tax,
    discount: totals.discount,
    total: totals.total,
    payments: input.payments
      .filter((p) => p.amount > 0)
      .map((p) => ({
        label: p.operation_number ? `${METHOD_LABEL[p.method]} #${p.operation_number}` : METHOD_LABEL[p.method],
        amount: p.method === 'efectivo' ? (p.tendered ?? p.amount) : p.amount,
      })),
    change,
    offline: !outcome.synced && !outcome.error,
  };

  return {
    synced: outcome.synced,
    offline: !outcome.synced && !outcome.error,
    error: outcome.error,
    result: outcome.result,
    ticket,
    clientUuid,
  };
}

export async function printTicket(ticket: TicketData, printer: PrinterConfig) {
  await printBytes(buildSaleTicket(ticket, printer));
}

/** Texto del comprobante para compartir por WhatsApp (wa.me). */
export function ticketToWhatsApp(t: TicketData, symbol: string): string {
  const lines = [
    `*${t.business.trade_name}*`,
    `Ticket N° ${t.saleNumber} — ${t.date.toLocaleString('es-PE')}`,
    '',
    ...t.lines.map((l) => `• ${l.name} ${l.qty} = ${symbol}${l.total.toFixed(2)}`),
    '',
    `*TOTAL: ${symbol}${t.total.toFixed(2)}*`,
    ...t.payments.map((p) => `${p.label}: ${symbol}${p.amount.toFixed(2)}`),
    t.business.ticket_footer ?? '',
  ];
  return lines.join('\n');
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const intl = digits.length === 9 ? `51${digits}` : digits; // Perú por defecto
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
