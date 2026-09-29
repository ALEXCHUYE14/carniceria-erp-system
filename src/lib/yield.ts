// =====================================================================
// Yield Analytics — cálculo de rendimiento y prorrateo de costo por valor comercial
// Rendimiento (%) = Σ kg cortes comerciales / kg canal × 100
// Costo corte_i = costo_total × (kg_i × factor_i) / Σ (kg_j × factor_j)
// =====================================================================
import { round } from './utils';

export interface YieldInputRow {
  product_id: string;
  name: string;
  kg: number;
  is_commercial: boolean;
  value_factor: number;
  sale_price?: number;
}

export interface YieldRowResult extends YieldInputRow {
  pct_of_carcass: number;
  allocated_cost: number;
  cost_per_kg: number;
  margin_per_kg: number | null;
  margin_pct: number | null;
}

export interface YieldResult {
  rows: YieldRowResult[];
  commercial_kg: number;
  byproduct_kg: number;
  weighed_kg: number;
  loss_kg: number;
  loss_pct: number;
  yield_pct: number;
  real_cost_per_commercial_kg: number;
  potential_revenue: number;
  potential_margin: number;
  warnings: string[];
}

export function computeYield(hookWeightKg: number, totalCost: number, rows: YieldInputRow[]): YieldResult {
  const warnings: string[] = [];
  const valid = rows.filter((r) => r.kg > 0);
  const commercial = valid.filter((r) => r.is_commercial);
  const commercial_kg = round(commercial.reduce((a, r) => a + r.kg, 0), 3);
  const byproduct_kg = round(valid.filter((r) => !r.is_commercial).reduce((a, r) => a + r.kg, 0), 3);
  const weighed_kg = round(commercial_kg + byproduct_kg, 3);
  const loss_kg = round(Math.max(hookWeightKg - weighed_kg, 0), 3);
  const weighted = commercial.reduce((a, r) => a + r.kg * r.value_factor, 0);

  if (hookWeightKg <= 0) warnings.push('El peso en gancho debe ser mayor a 0.');
  if (weighed_kg > hookWeightKg * 1.02) warnings.push('Los kg despiezados superan el peso en gancho (+2% tolerancia).');
  if (commercial.length > 0 && weighted <= 0) warnings.push('Los factores de valor comercial deben ser mayores a 0.');

  // Prorrateo con cuadre de redondeo en el corte de mayor peso ponderado
  const allocations = new Map<string, number>();
  if (weighted > 0) {
    const sorted = [...commercial].sort((a, b) => b.kg * b.value_factor - a.kg * a.value_factor);
    const [top, ...rest] = sorted;
    let acc = 0;
    for (const r of rest) {
      const alloc = round((totalCost * (r.kg * r.value_factor)) / weighted, 2);
      allocations.set(r.product_id, alloc);
      acc += alloc;
    }
    if (top) allocations.set(top.product_id, round(totalCost - acc, 2));
  }

  let potential_revenue = 0;
  const out: YieldRowResult[] = rows.map((r) => {
    const allocated_cost = r.is_commercial ? (allocations.get(r.product_id) ?? 0) : 0;
    const cost_per_kg = r.kg > 0 ? round(allocated_cost / r.kg, 4) : 0;
    const margin_per_kg = r.sale_price !== undefined && r.kg > 0 ? round(r.sale_price - cost_per_kg, 2) : null;
    const margin_pct = r.sale_price && r.sale_price > 0 && margin_per_kg !== null ? round((margin_per_kg / r.sale_price) * 100, 1) : null;
    if (r.sale_price) potential_revenue += r.sale_price * r.kg;
    if (margin_pct !== null && margin_pct < 0) warnings.push(`"${r.name}" queda con costo mayor a su precio de venta.`);
    return {
      ...r,
      pct_of_carcass: hookWeightKg > 0 ? round((r.kg / hookWeightKg) * 100, 2) : 0,
      allocated_cost,
      cost_per_kg,
      margin_per_kg,
      margin_pct,
    };
  });

  return {
    rows: out,
    commercial_kg,
    byproduct_kg,
    weighed_kg,
    loss_kg,
    loss_pct: hookWeightKg > 0 ? round((loss_kg / hookWeightKg) * 100, 2) : 0,
    yield_pct: hookWeightKg > 0 ? round((commercial_kg / hookWeightKg) * 100, 2) : 0,
    real_cost_per_commercial_kg: commercial_kg > 0 ? round(totalCost / commercial_kg, 4) : 0,
    potential_revenue: round(potential_revenue, 2),
    potential_margin: round(potential_revenue - totalCost, 2),
    warnings,
  };
}
