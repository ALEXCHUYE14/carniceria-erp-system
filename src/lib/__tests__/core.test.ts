import { describe, expect, it } from 'vitest';
import { computeTotals, grossKgForNet, lineTotal, maxDiscountAmount, paymentSummary, shrinkKg, validateDiscount, validatePayments } from '../pricing';
import { computeYield } from '../yield';
import { decodeCommand, FrameBuffer, parseScaleFrame, StabilityDetector } from '../hardware/scaleParser';
import type { CartLine } from '@/types';

const line = (q: number, price: number, shrink = 0, surcharge = 0): CartLine => ({
  key: 'k', product_id: 'p', product_name: 'x', unit: 'kg', quantity: q, unit_price: price,
  cut_type_id: null, cut_type_name: null, shrink_pct: shrink, surcharge_per_kg: surcharge, lot_id: null, weight_source: 'manual',
});

describe('pricing (mismo algoritmo que create_sale en SQL)', () => {
  it('merma de preparación: kg brutos para entregar neto', () => {
    expect(grossKgForNet(3, 5)).toBe(3.158);
    expect(shrinkKg(3, 5)).toBe(0.158);
    expect(grossKgForNet(1, 0)).toBe(1);
  });

  it('total de línea incluye recargo por kg', () => {
    expect(lineTotal(line(3, 65, 5, 0.5))).toBe(196.5);
  });

  it('IGV incluido en precio (Perú): 235.50 → 199.58 + 35.92', () => {
    const t = computeTotals([line(3, 65, 5, 0.5), line(1.5, 26)], 0, 18, true);
    expect(t).toMatchObject({ total: 235.5, subtotal: 199.58, tax: 35.92 });
  });

  it('pagos mixtos y vuelto solo sobre efectivo', () => {
    const s = paymentSummary(80, [
      { method: 'yape', amount: 30, operation_number: '1234' },
      { method: 'efectivo', amount: 50, tendered: 100 },
    ]);
    expect(s).toMatchObject({ paid: 80, remaining: 0, change: 50, complete: true });
  });

  it('valida Yape sin número de operación y fiado sin cliente', () => {
    expect(validatePayments(10, [{ method: 'yape', amount: 10 }], false)).toMatch(/operación/);
    expect(validatePayments(10, [{ method: 'credito', amount: 10 }], false)).toMatch(/cliente/);
    expect(validatePayments(10, [{ method: 'efectivo', amount: 10, tendered: 20 }], false)).toBeNull();
  });

  it('tope de descuento para no-admin (igual que create_sale)', () => {
    expect(maxDiscountAmount(235.5, 10)).toBe(23.55);
    expect(validateDiscount(235.5, 23.55, 10, false)).toBeNull();
    expect(validateDiscount(235.5, 23.6, 10, false)).toMatch(/máximo/);
    expect(validateDiscount(235.5, 200, 10, true)).toBeNull();
    // configuración sin migrar: el cliente no bloquea, decide el servidor
    expect(validateDiscount(100, 50, undefined, false)).toBeNull();
  });
});

describe('yield analytics', () => {
  // Mismo caso probado contra PostgreSQL (process_carcass): 250 kg, S/ 3500
  const rows = [
    { product_id: 'lom', name: 'Lomo', kg: 8, is_commercial: true, value_factor: 3 },
    { product_id: 'bif', name: 'Bife', kg: 40, is_commercial: true, value_factor: 1.8 },
    { product_id: 'asa', name: 'Asado', kg: 35, is_commercial: true, value_factor: 1.4 },
    { product_id: 'pec', name: 'Pecho', kg: 30, is_commercial: true, value_factor: 1 },
    { product_id: 'oso', name: 'Osobuco', kg: 20, is_commercial: true, value_factor: 0.8 },
    { product_id: 'mol', name: 'Molida', kg: 45, is_commercial: true, value_factor: 1 },
    { product_id: 'gra', name: 'Grasa', kg: 25, is_commercial: false, value_factor: 0 },
    { product_id: 'hue', name: 'Hueso', kg: 38, is_commercial: false, value_factor: 0 },
  ];
  const r = computeYield(250, 3500, rows);

  it('rendimiento = Σ comerciales / gancho', () => {
    expect(r.commercial_kg).toBe(178);
    expect(r.yield_pct).toBe(71.2);
    expect(r.loss_kg).toBe(9);
  });

  it('prorrateo por valor comercial cuadra exacto al costo total', () => {
    const sum = r.rows.reduce((a, x) => a + x.allocated_cost, 0);
    expect(Math.round(sum * 100) / 100).toBe(3500);
    expect(r.rows.find((x) => x.product_id === 'lom')?.allocated_cost).toBe(355.93);
    expect(r.rows.find((x) => x.product_id === 'gra')?.allocated_cost).toBe(0);
  });
});

describe('parser de balanzas', () => {
  it('CAS con indicador de estabilidad', () => {
    expect(parseScaleFrame('ST,GS,+  1.250kg')).toMatchObject({ weightKg: 1.25, stableFlag: true });
    expect(parseScaleFrame('US,GS,+  0.998kg')).toMatchObject({ weightKg: 0.998, stableFlag: false });
  });

  it('Toledo en gramos con STX y divisor', () => {
    expect(parseScaleFrame('\x02 1250', 1000)?.weightKg).toBe(1.25);
  });

  it('Kretz con coma decimal', () => {
    expect(parseScaleFrame('PESO:   1,375 KG')?.weightKg).toBe(1.375);
  });

  it('peso negativo (tara)', () => {
    expect(parseScaleFrame('-0.120 kg')?.weightKg).toBe(-0.12);
  });

  it('separa tramas por CR/LF/ETX y conserva fragmentos', () => {
    const fb = new FrameBuffer();
    expect(fb.push('ST,GS,+ 1.2')).toEqual([]);
    expect(fb.push('50kg\r\nST,GS,+ 1.260kg\x03')).toEqual(['ST,GS,+ 1.250kg', 'ST,GS,+ 1.260kg']);
  });

  it('estabilidad por ventana deslizante', () => {
    const d = new StabilityDetector(3, 0.002);
    expect(d.push(1.0)).toBe(false);
    expect(d.push(1.001)).toBe(false);
    expect(d.push(1.002)).toBe(true);
    expect(d.push(1.05)).toBe(false);
  });

  it('decodifica comandos escapados', () => {
    expect(Array.from(decodeCommand('\\x05'))).toEqual([5]);
    expect(Array.from(decodeCommand('W\\r'))).toEqual([87, 13]);
  });
});
