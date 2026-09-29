import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, CloudOff, RefreshCw, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, Stat, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { useSettings } from '@/hooks/useCatalog';
import { useAuthStore } from '@/stores/authStore';
import { db } from '@/lib/offline/db';
import { discardFailed, retryFailed } from '@/lib/offline/sync';
import { friendlyError, supabase } from '@/lib/supabase';
import { formatDate, formatKg, formatMoney, todayISO } from '@/lib/utils';
import { METHOD_LABEL } from '@/features/pos/checkout';
import type { OutboxEntry, PaymentMethod, Sale, SalePayload } from '@/types';

interface SaleDetail {
  items: Array<{ id: string; quantity: number; shrink_kg: number; unit_price: number; line_total: number; products: { name: string; unit: 'kg' | 'und' } | null; cut_types: { name: string } | null }>;
  payments: Array<{ id: string; method: PaymentMethod; amount: number; operation_number: string | null }>;
}

export function SalesPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  const [day, setDay] = useState(todayISO());
  const [selected, setSelected] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const outbox = useLiveQuery(() => db.outbox.where('status').anyOf('pending', 'syncing', 'failed').toArray(), []) ?? [];

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales', day],
    queryFn: async () => {
      const from = new Date(`${day}T00:00:00`);
      const to = new Date(from.getTime() + 86_400_000);
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Sale[]).map((s) => ({ ...s, total: Number(s.total), subtotal: Number(s.subtotal), tax_amount: Number(s.tax_amount) }));
    },
  });

  const { data: detail } = useQuery({
    queryKey: ['sale-detail', selected?.id],
    enabled: !!selected,
    queryFn: async (): Promise<SaleDetail> => {
      const [items, payments] = await Promise.all([
        supabase.from('sale_items').select('id, quantity, shrink_kg, unit_price, line_total, products(name, unit), cut_types(name)').eq('sale_id', selected!.id),
        supabase.from('payment_transactions').select('id, method, amount, operation_number').eq('sale_id', selected!.id),
      ]);
      if (items.error) throw items.error;
      if (payments.error) throw payments.error;
      return { items: items.data as unknown as SaleDetail['items'], payments: payments.data as SaleDetail['payments'] };
    },
  });

  const voidSale = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_sale', { p_sale_id: selected!.id, p_reason: voidReason.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Venta anulada; stock y cuenta corriente revertidos');
      setSelected(null);
      setVoidReason('');
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const completed = sales.filter((s) => s.status === 'completada');
  const total = completed.reduce((a, s) => a + s.total, 0);
  const avg = completed.length ? total / completed.length : 0;
  const byTerminal = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of completed) m.set(s.terminal_id ?? '—', (m.get(s.terminal_id ?? '—') ?? 0) + s.total);
    return [...m.entries()];
  }, [completed]);

  return (
    <div className="space-y-4 p-3 md:p-4">
      {outbox.length > 0 && <OutboxPanel entries={outbox} symbol={symbol} />}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Fecha">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
        </Field>
        <p className="pb-3 text-sm text-muted-foreground">{isAdmin ? 'Todas las cajas' : 'Solo sus ventas'}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ventas del día" value={formatMoney(total, symbol)} />
        <Stat label="Tickets" value={completed.length} />
        <Stat label="Ticket promedio" value={formatMoney(avg, symbol)} />
        <Stat label="Anuladas" value={sales.length - completed.length} tone={sales.length - completed.length ? 'warning' : undefined} hint={byTerminal.map(([t, v]) => `${t}: ${formatMoney(v, symbol)}`).join(' · ')} />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : sales.length === 0 ? (
        <EmptyState icon={<Receipt />} title="Sin ventas en esta fecha" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>N°</th><th>Hora</th><th>Caja</th><th className="text-right">Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                  <td className="font-mono font-semibold">{s.sale_number}</td>
                  <td>{new Date(s.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{s.terminal_id ?? '—'}</td>
                  <td className="text-right font-semibold">{formatMoney(s.total, symbol)}</td>
                  <td>{s.status === 'anulada' ? <Badge tone="danger">Anulada</Badge> : <Badge tone="success">OK</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)} title={`Venta N° ${selected?.sale_number ?? ''}`} description={selected ? formatDate(selected.created_at, true) : ''}>
        {selected && (
          <div className="space-y-4 text-sm">
            <ul className="divide-y rounded-lg border">
              {detail?.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 p-3">
                  <div>
                    <p className="font-semibold">{i.products?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatKg(Number(i.quantity), i.products?.unit ?? 'kg')} × {formatMoney(Number(i.unit_price), symbol)}
                      {i.cut_types && ` · ${i.cut_types.name}`}
                      {Number(i.shrink_kg) > 0 && ` · merma ${formatKg(Number(i.shrink_kg))}`}
                    </p>
                  </div>
                  <p className="font-bold">{formatMoney(Number(i.line_total), symbol)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              {detail?.payments.map((p) => (
                <p key={p.id} className="flex justify-between">
                  <span>{METHOD_LABEL[p.method]} {p.operation_number && <span className="font-mono text-xs text-muted-foreground">#{p.operation_number}</span>}</span>
                  <span className="tabular-nums">{formatMoney(Number(p.amount), symbol)}</span>
                </p>
              ))}
              <p className="flex justify-between border-t pt-2 text-base font-bold">
                <span>Total</span>
                <span>{formatMoney(selected.total, symbol)}</span>
              </p>
            </div>
            {isAdmin && selected.status === 'completada' && (
              <div className="space-y-2 rounded-lg border border-meat/30 p-3">
                <Field label="Motivo de anulación">
                  <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                </Field>
                <Button variant="destructive" disabled={voidReason.trim().length < 5 || voidSale.isPending} onClick={() => voidSale.mutate()}>
                  <Ban /> Anular venta
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function OutboxPanel({ entries, symbol }: { entries: OutboxEntry[]; symbol: string }) {
  return (
    <Card className="border-bone/50 p-4">
      <p className="mb-2 flex items-center gap-2 font-bold">
        <CloudOff className="size-5 text-bone-dark" /> Operaciones pendientes de sincronizar ({entries.length})
      </p>
      <ul className="divide-y text-sm">
        {entries.map((e) => {
          const sale = e.kind === 'sale' ? (e.payload as SalePayload) : null;
          const amount = sale ? sale.payments.reduce((a, p) => a + p.amount, 0) : (e.payload as { amount: number }).amount;
          return (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
              <Badge tone={e.status === 'failed' ? 'danger' : 'warning'}>{e.status === 'failed' ? 'Error' : 'Pendiente'}</Badge>
              <span className="font-semibold">{e.kind === 'sale' ? 'Venta' : 'Abono'} {formatMoney(amount, symbol)}</span>
              <span className="text-xs text-muted-foreground">{formatDate(e.created_at, true)}</span>
              {e.last_error && <span className="w-full text-xs text-meat">{e.last_error}</span>}
              {e.status === 'failed' && (
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => void retryFailed(e.id)}>
                    <RefreshCw /> Reintentar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('¿Descartar esta operación? No se registrará en el servidor.')) void discardFailed(e.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
