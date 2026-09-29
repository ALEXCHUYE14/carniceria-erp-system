import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('TU-PROYECTO'));

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const QR_BUCKET = 'qr-codes';

/** URL pública de un objeto en el bucket de QR, con cache-busting por fecha de actualización. */
export function publicQrUrl(path: string | null | undefined, version?: string): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(QR_BUCKET).getPublicUrl(path);
  return version ? `${data.publicUrl}?v=${encodeURIComponent(version)}` : data.publicUrl;
}

/** Traduce errores de Postgres/Supabase a mensajes legibles para el cajero. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Error desconocido';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; code?: string; details?: string };
  if (e.code === '23505' && e.message?.includes('uq_wallet_operation')) {
    return 'Ese número de operación Yape/Plin ya fue registrado en otra venta.';
  }
  if (e.code === '42501') return 'No tienes permisos para esta acción.';
  if (e.message?.includes('Failed to fetch')) return 'Sin conexión con el servidor.';
  return e.message ?? 'Error desconocido';
}

/** Distingue errores de red (reintentar luego) de errores de negocio (no reintentar). */
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg = (err as { message?: string })?.message ?? String(err);
  return /Failed to fetch|NetworkError|network|timeout|ECONN|Load failed/i.test(msg);
}
