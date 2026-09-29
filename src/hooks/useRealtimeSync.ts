// =====================================================================
// Sincronización multiterminal vía Supabase Realtime
// - Cambios de stock/precios en products -> invalida catálogo en todas las cajas
// - Cambios en business_settings (QR Yape/Plin, IGV, pie de ticket) -> refresco inmediato
// =====================================================================
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/offline/db';
import { queryKeys } from './useCatalog';
import type { Product } from '@/types';

export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('erp-multiterminal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async (payload) => {
        // Actualización quirúrgica en caché (evita refetch completo por cada venta)
        if (payload.eventType === 'UPDATE' && payload.new) {
          const updated = payload.new as Product;
          await db.products.put(updated);
          qc.setQueryData<Product[]>(queryKeys.products, (old) =>
            old?.map((p) =>
              p.id === updated.id
                ? { ...updated, stock_actual_kg: Number(updated.stock_actual_kg), price_per_unit: Number(updated.price_per_unit) }
                : p,
            ),
          );
        } else {
          void qc.invalidateQueries({ queryKey: queryKeys.products });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_settings' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.settings });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_lots' }, () => {
        void qc.invalidateQueries({ queryKey: ['lots'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.customers });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
