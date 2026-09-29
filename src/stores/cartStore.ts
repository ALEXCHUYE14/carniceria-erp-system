import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine, Customer, CutType, Product, WeightSource } from '@/types';
import { round, uuid } from '@/lib/utils';

interface CartState {
  lines: CartLine[];
  customer: Pick<Customer, 'id' | 'full_name' | 'credit_enabled' | 'credit_limit' | 'balance' | 'oldest_due_date' | 'phone'> | null;
  discount: number;
  selectedLineKey: string | null;
  addProduct: (p: Product, quantity: number, source: WeightSource, cut?: CutType | null, lotId?: string | null) => void;
  updateQuantity: (key: string, quantity: number, source?: WeightSource) => void;
  setCut: (key: string, cut: CutType | null) => void;
  setLot: (key: string, lotId: string | null) => void;
  removeLine: (key: string) => void;
  selectLine: (key: string | null) => void;
  setCustomer: (c: CartState['customer']) => void;
  setDiscount: (v: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      customer: null,
      discount: 0,
      selectedLineKey: null,

      addProduct: (p, quantity, source, cut, lotId) =>
        set((s) => {
          const qty = p.sell_by_weight ? round(quantity, 3) : Math.max(1, Math.round(quantity));
          // Productos por unidad del mismo tipo se agrupan; los de peso siempre son línea nueva (cada pesada es única)
          if (!p.sell_by_weight) {
            const existing = s.lines.find((l) => l.product_id === p.id && !l.cut_type_id);
            if (existing) {
              return {
                lines: s.lines.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + qty } : l)),
                selectedLineKey: existing.key,
              };
            }
          }
          const line: CartLine = {
            key: uuid(),
            product_id: p.id,
            product_name: p.name,
            unit: p.unit,
            quantity: qty,
            unit_price: p.price_per_unit,
            cut_type_id: cut?.id ?? null,
            cut_type_name: cut?.name ?? null,
            shrink_pct: cut?.shrink_pct ?? 0,
            surcharge_per_kg: cut?.surcharge_per_kg ?? 0,
            lot_id: lotId ?? null,
            weight_source: source,
          };
          return { lines: [...s.lines, line], selectedLineKey: line.key };
        }),

      updateQuantity: (key, quantity, source) =>
        set((s) => ({
          lines: s.lines
            .map((l) =>
              l.key === key
                ? { ...l, quantity: l.unit === 'kg' ? round(quantity, 3) : Math.round(quantity), weight_source: source ?? l.weight_source }
                : l,
            )
            .filter((l) => l.quantity > 0),
        })),

      setCut: (key, cut) =>
        set((s) => ({
          lines: s.lines.map((l) =>
            l.key === key
              ? {
                  ...l,
                  cut_type_id: cut?.id ?? null,
                  cut_type_name: cut?.name ?? null,
                  shrink_pct: cut?.shrink_pct ?? 0,
                  surcharge_per_kg: cut?.surcharge_per_kg ?? 0,
                }
              : l,
          ),
        })),

      setLot: (key, lotId) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, lot_id: lotId } : l)) })),
      removeLine: (key) =>
        set((s) => ({ lines: s.lines.filter((l) => l.key !== key), selectedLineKey: s.selectedLineKey === key ? null : s.selectedLineKey })),
      selectLine: (selectedLineKey) => set({ selectedLineKey }),
      setCustomer: (customer) => set({ customer }),
      setDiscount: (discount) => set({ discount: Math.max(0, round(discount, 2)) }),
      clear: () => set({ lines: [], customer: null, discount: 0, selectedLineKey: null }),
    }),
    { name: 'carni-cart' }, // el ticket en curso sobrevive a recargas / cortes de luz
  ),
);
