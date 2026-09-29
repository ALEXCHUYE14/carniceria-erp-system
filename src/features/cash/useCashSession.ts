// =====================================================================
// Turno de caja vigente por terminal (network-first con respaldo en IndexedDB)
// =====================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getKV, setKV } from '@/lib/offline/db';
import type { CashSession, CashSummary } from '@/types';

export const cashKeys = {
  current: (terminalId: string) => ['cash_session', terminalId] as const,
  summary: (sessionId: string) => ['cash_summary', sessionId] as const,
  movements: (sessionId: string) => ['cash_movements', sessionId] as const,
  history: ['cash_history'] as const,
};

export interface CurrentCashSession {
  session: CashSession | null;
  /** true si el dato viene del servidor; false si es caché (sin red o tabla aún no migrada). */
  verified: boolean;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function normalizeSession(row: CashSession): CashSession {
  return {
    ...row,
    opening_amount: Number(row.opening_amount),
    expected_cash: num(row.expected_cash),
    counted_cash: num(row.counted_cash),
    difference: num(row.difference),
  };
}

export function useCurrentCashSession(terminalId: string) {
  return useQuery({
    queryKey: cashKeys.current(terminalId),
    queryFn: async (): Promise<CurrentCashSession> => {
      const cacheKey = `cash_session:${terminalId}`;
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase
            .from('cash_sessions')
            .select('*')
            .eq('terminal_id', terminalId)
            .eq('status', 'abierta')
            .maybeSingle();
          if (error) throw error;
          const session = data ? normalizeSession(data as CashSession) : null;
          await setKV(cacheKey, session);
          return { session, verified: true };
        } catch {
          /* sin red o esquema sin migrar: usar caché y no bloquear la venta */
        }
      }
      return { session: (await getKV<CashSession | null>(cacheKey)) ?? null, verified: false };
    },
    refetchInterval: 60_000,
  });
}

export function useCashSummary(sessionId: string | undefined) {
  return useQuery({
    queryKey: cashKeys.summary(sessionId ?? 'none'),
    enabled: !!sessionId,
    queryFn: async (): Promise<CashSummary> => {
      const { data, error } = await supabase.rpc('cash_session_summary', { p_session_id: sessionId });
      if (error) throw error;
      return data as CashSummary;
    },
    refetchInterval: 30_000,
  });
}
