// =====================================================================
// Motor de sincronización offline-first
// - Las ventas se guardan SIEMPRE primero en la outbox local (Dexie).
// - Se envían a Supabase vía RPC create_sale (idempotente por client_uuid).
// - Errores de red => quedan pendientes y se reintentan con backoff.
// - Errores de negocio (stock, crédito) => 'failed' para revisión del supervisor.
// =====================================================================
import { db } from './db';
import { isNetworkError, supabase, friendlyError } from '@/lib/supabase';
import type { CreateSaleResult, OutboxEntry, SalePayload } from '@/types';
import { useSyncStore } from '@/stores/syncStore';

const MAX_ATTEMPTS = 8;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export interface CustomerPaymentPayload {
  client_uuid: string;
  customer_id: string;
  amount: number;
  method: 'efectivo' | 'yape' | 'plin' | 'tarjeta';
  operation_number: string | null;
  note: string | null;
}

export async function enqueueSale(payload: SalePayload): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: payload.client_uuid,
    kind: 'sale',
    payload,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    synced_at: null,
    result: null,
  };
  await db.outbox.put(entry);
  await refreshCounters();
  return entry;
}

export async function enqueueCustomerPayment(payload: CustomerPaymentPayload): Promise<void> {
  await db.outbox.put({
    id: payload.client_uuid,
    kind: 'customer_payment',
    payload,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    synced_at: null,
    result: null,
  });
  await refreshCounters();
}

async function pushEntry(entry: OutboxEntry): Promise<unknown> {
  if (entry.kind === 'sale') {
    const { data, error } = await supabase.rpc('create_sale', { payload: entry.payload });
    if (error) throw error;
    return data as CreateSaleResult;
  }
  const p = entry.payload as CustomerPaymentPayload;
  const { data, error } = await supabase.rpc('register_customer_payment', {
    p_customer_id: p.customer_id,
    p_amount: p.amount,
    p_method: p.method,
    p_operation_number: p.operation_number,
    p_note: p.note,
  });
  if (error) throw error;
  return data;
}

/** Envía una venta de inmediato si hay red; si no, queda en cola. Devuelve el resultado si sincronizó. */
export async function submitSale(payload: SalePayload): Promise<{ synced: boolean; result?: CreateSaleResult; error?: string }> {
  const entry = await enqueueSale(payload);
  if (!navigator.onLine) return { synced: false };
  try {
    await db.outbox.update(entry.id, { status: 'syncing' });
    const result = (await pushEntry(entry)) as CreateSaleResult;
    await db.outbox.update(entry.id, { status: 'done', synced_at: new Date().toISOString(), result, attempts: 1 });
    await refreshCounters();
    return { synced: true, result };
  } catch (err) {
    if (isNetworkError(err)) {
      await db.outbox.update(entry.id, { status: 'pending', attempts: 1, last_error: friendlyError(err) });
      await refreshCounters();
      scheduleSync(3000);
      return { synced: false };
    }
    // Error de negocio en línea: se descarta de la cola y se informa al cajero para corregir
    await db.outbox.delete(entry.id);
    await refreshCounters();
    return { synced: false, error: friendlyError(err) };
  }
}

export async function syncOutbox(): Promise<{ ok: number; failed: number }> {
  if (running || !navigator.onLine) return { ok: 0, failed: 0 };
  running = true;
  useSyncStore.getState().setSyncing(true);
  let ok = 0;
  let failed = 0;
  try {
    const pending = await db.outbox.where('status').anyOf('pending', 'syncing').sortBy('created_at');
    for (const entry of pending) {
      try {
        await db.outbox.update(entry.id, { status: 'syncing' });
        const result = await pushEntry(entry);
        await db.outbox.update(entry.id, { status: 'done', synced_at: new Date().toISOString(), result, last_error: null });
        ok++;
      } catch (err) {
        const attempts = entry.attempts + 1;
        const network = isNetworkError(err);
        await db.outbox.update(entry.id, {
          status: network && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
          attempts,
          last_error: friendlyError(err),
        });
        if (network) break; // se perdió la red: detener el lote y reintentar luego
        failed++;
      }
    }
    // Limpieza: conservar ventas sincronizadas 7 días (reimpresión / auditoría local)
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await db.outbox.where('status').equals('done').and((e) => (e.synced_at ?? '') < cutoff).delete();
  } finally {
    running = false;
    useSyncStore.getState().setSyncing(false);
    useSyncStore.getState().setLastSync(new Date().toISOString());
    await refreshCounters();
  }
  const stillPending = await db.outbox.where('status').equals('pending').count();
  if (stillPending > 0) scheduleSync();
  return { ok, failed };
}

export async function retryFailed(id: string) {
  await db.outbox.update(id, { status: 'pending', attempts: 0 });
  await refreshCounters();
  return syncOutbox();
}

export async function discardFailed(id: string) {
  await db.outbox.delete(id);
  await refreshCounters();
}

function scheduleSync(delay?: number) {
  if (timer) clearTimeout(timer);
  const attempts = useSyncStore.getState().pending;
  const backoff = delay ?? Math.min(60_000, 5_000 * Math.max(1, attempts));
  timer = setTimeout(() => void syncOutbox(), backoff);
}

export async function refreshCounters() {
  const [pending, failed] = await Promise.all([
    db.outbox.where('status').anyOf('pending', 'syncing').count(),
    db.outbox.where('status').equals('failed').count(),
  ]);
  useSyncStore.getState().setCounters(pending, failed);
}

/** Registrar listeners globales una sola vez al iniciar la app. */
export function startSyncEngine() {
  const onOnline = () => {
    useSyncStore.getState().setOnline(true);
    void syncOutbox();
  };
  const onOffline = () => useSyncStore.getState().setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncOutbox();
  });
  const interval = setInterval(() => void syncOutbox(), 60_000);
  void refreshCounters().then(() => syncOutbox());
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    clearInterval(interval);
  };
}
