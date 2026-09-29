// =====================================================================
// Consultas de catálogo con estrategia network-first + fallback IndexedDB
// =====================================================================
import { useQuery } from '@tanstack/react-query';
import type { Table } from 'dexie';
import { supabase } from '@/lib/supabase';
import { db, getKV, replaceTable, cacheSettings } from '@/lib/offline/db';
import type { BusinessSettings, Category, Customer, CutType, InventoryLot, Product } from '@/types';

async function networkFirst<T>(
  fetcher: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  table: Table<T, string>,
): Promise<T[]> {
  if (navigator.onLine) {
    try {
      const { data, error } = await fetcher();
      if (error) throw error;
      const rows = (data ?? []) as T[];
      await replaceTable(table, rows);
      return rows;
    } catch (err) {
      const cached = await table.toArray();
      if (cached.length) return cached;
      throw err;
    }
  }
  return table.toArray();
}

const numeric = <T extends object>(row: T, keys: Array<keyof T>): T => {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') (out as Record<keyof T, unknown>)[k] = Number(v);
  }
  return out;
};

export const queryKeys = {
  settings: ['settings'] as const,
  products: ['products'] as const,
  categories: ['categories'] as const,
  cutTypes: ['cut_types'] as const,
  customers: ['customers'] as const,
  lots: (productId?: string) => ['lots', productId ?? 'all'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async (): Promise<BusinessSettings> => {
      try {
        const { data, error } = await supabase.from('business_settings').select('*').eq('id', 1).single();
        if (error) throw error;
        const s = numeric(data as BusinessSettings, ['tax_rate']);
        await cacheSettings(s);
        return s;
      } catch (err) {
        const cached = await getKV<BusinessSettings>('business_settings');
        if (cached) return cached;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: async () => {
      const rows = await networkFirst<Product>(
        () => supabase.from('products').select('*').eq('active', true).order('name'),
        db.products,
      );
      return rows.map((p) =>
        numeric(p, ['price_per_unit', 'cost_per_unit', 'stock_actual_kg', 'min_stock_kg', 'value_factor']),
      );
    },
  });
}

/** Incluye inactivos: para mantenimiento de catálogo (admin). */
export function useAllProducts() {
  return useQuery({
    queryKey: [...queryKeys.products, 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (error) throw error;
      return (data as Product[]).map((p) =>
        numeric(p, ['price_per_unit', 'cost_per_unit', 'stock_actual_kg', 'min_stock_kg', 'value_factor']),
      );
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () =>
      networkFirst<Category>(() => supabase.from('categories').select('*').eq('active', true).order('sort_order'), db.categories),
  });
}

export function useCutTypes() {
  return useQuery({
    queryKey: queryKeys.cutTypes,
    queryFn: async () => {
      const rows = await networkFirst<CutType>(
        () => supabase.from('cut_types').select('*').eq('active', true).order('sort_order'),
        db.cutTypes,
      );
      return rows.map((c) => numeric(c, ['shrink_pct', 'surcharge_per_kg']));
    },
  });
}

export function useCustomers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.customers,
    enabled,
    queryFn: async () => {
      const rows = await networkFirst<Customer>(
        () => supabase.from('customers').select('*').eq('active', true).order('full_name'),
        db.customers,
      );
      return rows.map((c) => numeric(c, ['credit_limit', 'balance']));
    },
  });
}

/** Lotes activos ordenados FIFO (vencimiento, ingreso) — para selector en POS. */
export function useActiveLots(productId?: string) {
  return useQuery({
    queryKey: queryKeys.lots(productId),
    queryFn: async () => {
      const rows = await networkFirst<InventoryLot>(
        // Siempre se cachean todos los lotes activos (volumen bajo) y se filtra en cliente
        () =>
          supabase
            .from('inventory_lots')
            .select('*')
            .eq('status', 'activo')
            .gt('remaining_kg', 0)
            .order('expiry_date', { ascending: true, nullsFirst: false })
            .order('received_at', { ascending: true }),
        db.lots,
      );
      const list = rows
        .map((l) => numeric(l, ['initial_kg', 'remaining_kg', 'unit_cost']))
        .sort((a, b) =>
          (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') || a.received_at.localeCompare(b.received_at),
        );
      return productId ? list.filter((l) => l.product_id === productId) : list;
    },
  });
}
