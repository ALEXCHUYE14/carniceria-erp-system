import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Plus, Printer, ScanLine, Search, Snowflake } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { useAllProducts, useSettings } from '@/hooks/useCatalog';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { buildLotLabel, printBytes } from '@/lib/hardware/escpos';
import { friendlyError, supabase } from '@/lib/supabase';
import { cn, daysUntil, formatDate, formatKg, formatMoney, parseDecimal, todayISO } from '@/lib/utils';
import type { LotStatus, LotTraceability } from '@/types';

const CameraScanner = lazy(() => import('@/components/CameraScanner').then((m) => ({ default: m.CameraScanner })));

type Filter = 'activos' | 'por_vencer' | 'vencidos' | 'todos';

/** Trazabilidad: camión/proveedor → canal → lote → corte vendido. Rotación FIFO. */
export function LotsPage() {
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';
  const canCreate = useAuthStore((s) => s.hasRole('admin', 'carnicero'));
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  const printer = useDeviceStore((s) => s.printer);
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>('activos');
  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<LotTraceability | null>(null);

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lots', 'trace'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_lot_traceability').select('*').order('expiry_date', { ascending: true, nullsFirst: false }).limit(1000);
      if (error) throw error;
      return (data as LotTraceability[]).map((l) => ({
        ...l,
        initial_kg: Number(l.initial_kg),
        remaining_kg: Number(l.remaining_kg),
        unit_cost: Number(l.unit_cost),
        sold_kg: Number(l.sold_kg),
      }));
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return lots.filter((l) => {
      const d = daysUntil(l.expiry_date);
      const byFilter =
        filter === 'todos' ||
        (filter === 'activos' && l.status === 'activo') ||
        (filter === 'por_vencer' && l.status === 'activo' && d !== null && d >= 0 && d <= 2) ||
        (filter === 'vencidos' && (l.status === 'vencido' || (l.status === 'activo' && d !== null && d < 0)));
      const byText =
        !term ||
        l.lot_number.toLowerCase().includes(term) ||
        l.product_name.toLowerCase().includes(term) ||
        (l.supplier_name ?? '').toLowerCase().includes(term) ||
        (l.carcass_code ?? '').toLowerCase().includes(term);
      return byFilter && byText;
    });
  }, [lots, filter, q]);

  const active = lots.filter((l) => l.status === 'activo');
  const expiringSoon = active.filter((l) => {
    const d = daysUntil(l.expiry_date);
    return d !== null && d >= 0 && d <= 2;
  });
  const expired = active.filter((l) => (daysUntil(l.expiry_date) ?? 1) < 0);
  const stockValue = active.reduce((a, l) => a + l.remaining_kg * l.unit_cost, 0);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LotStatus }) => {
      const { error } = await supabase.from('inventory_lots').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lote actualizado');
      void qc.invalidateQueries({ queryKey: ['lots'] });
      setDetail(null);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const printLabel = async (l: LotTraceability) => {
    try {
      await printBytes(buildLotLabel({ lot_number: l.lot_number, product: l.product_name, kg: l.remaining_kg, expiry: l.expiry_date, senasa: l.senasa_registry }, printer));
      toast.success('Etiqueta impresa');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lotes activos" value={active.length} />
        <Stat label="Vencen en ≤ 2 días" value={expiringSoon.length} tone={expiringSoon.length ? 'warning' : undefined} hint="Priorizar en mostrador" />
        <Stat label="Vencidos sin retirar" value={expired.length} tone={expired.length ? 'danger' : undefined} />
        <Stat label="Valor en cámara" value={formatMoney(stockValue, symbol)} hint={formatKg(active.reduce((a, l) => a + l.remaining_kg, 0))} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-3.5 size-5 text-muted-foreground" />
          <Input placeholder="Lote, producto, proveedor, canal…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-44">
          <option value="activos">Activos</option>
          <option value="por_vencer">Por vencer</option>
          <option value="vencidos">Vencidos</option>
          <option value="todos">Todos</option>
        </Select>
        <Button variant="secondary" onClick={() => setScanning(true)}>
          <ScanLine /> Escanear
        </Button>
        {canCreate && (
          <Button variant="meat" onClick={() => setCreating(true)}>
            <Plus /> Ingreso de lote
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Boxes />} title="Sin lotes para este filtro" />
      ) : (
        <>
          {/* Móvil: tarjetas */}
          <div className="grid gap-2 md:hidden">
            {filtered.map((l) => (
              <Card key={l.lot_id} className="p-3" onClick={() => setDetail(l)}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-bold">{l.lot_number}</p>
                  <ExpiryBadge date={l.expiry_date} status={l.status} />
                </div>
                <p className="font-semibold">{l.product_name}</p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-meat" style={{ width: `${(l.remaining_kg / l.initial_kg) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatKg(l.remaining_kg)} de {formatKg(l.initial_kg)} · {l.supplier_name ?? '—'}
                </p>
              </Card>
            ))}
          </div>
          {/* PC: tabla densa */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lote</th><th>Producto</th><th>Canal</th><th>Proveedor</th><th>SENASA</th><th>Faenado</th><th>Vence</th>
                  <th className="text-right">Inicial</th><th className="text-right">Vendido</th><th className="text-right">Saldo</th><th className="text-right">Costo/kg</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.lot_id} className="cursor-pointer" onClick={() => setDetail(l)}>
                    <td className="font-mono font-semibold">{l.lot_number}</td>
                    <td>{l.product_name}</td>
                    <td className="font-mono text-xs">{l.carcass_code ?? '—'}</td>
                    <td>{l.supplier_name ?? '—'}</td>
                    <td className="text-xs">{l.senasa_registry ?? '—'}</td>
                    <td>{formatDate(l.slaughter_date)}</td>
                    <td>{formatDate(l.expiry_date)}</td>
                    <td className="text-right">{l.initial_kg.toFixed(3)}</td>
                    <td className="text-right">{l.sold_kg.toFixed(3)}</td>
                    <td className="text-right font-semibold">{l.remaining_kg.toFixed(3)}</td>
                    <td className="text-right">{formatMoney(l.unit_cost, symbol)}</td>
                    <td><ExpiryBadge date={l.expiry_date} status={l.status} /></td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); void printLabel(l); }} className="rounded p-1.5 hover:bg-muted" title="Imprimir etiqueta">
                        <Printer className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {scanning && (<Suspense fallback={null}><CameraScanner
        open={scanning}
        onOpenChange={setScanning}
        title="Escanear lote"
        onResult={(text) => {
          const code = text.replace(/^LOT:/, '');
          const found = lots.find((l) => l.lot_number === code);
          if (found) setDetail(found);
          else {
            setQ(code);
            setFilter('todos');
            toast.info(`Lote ${code} no encontrado en la lista`);
          }
        }}
      /></Suspense>)}

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)} title={`Lote ${detail?.lot_number ?? ''}`} description={detail?.product_name}>
        {detail && (
          <div className="space-y-4 text-sm">
            <ol className="relative space-y-3 border-l-2 border-meat/40 pl-5">
              <TraceStep title="Proveedor / transporte" body={`${detail.supplier_name ?? '—'} · Placa ${detail.truck_plate ?? '—'} · Guía ${detail.guide_number ?? '—'}`} />
              <TraceStep
                title="Canal"
                body={`${detail.carcass_code ?? 'Ingreso directo'} · Faenado ${formatDate(detail.slaughter_date)}${detail.arrival_temp_c !== null ? ` · ${detail.arrival_temp_c}°C` : ''}`}
                icon={detail.arrival_temp_c !== null && detail.arrival_temp_c > 7 ? <AlertTriangle className="size-4 text-meat" /> : <Snowflake className="size-4 text-sky-500" />}
              />
              <TraceStep title="Lote" body={`${formatKg(detail.initial_kg)} · SENASA ${detail.senasa_registry ?? '—'} · Vence ${formatDate(detail.expiry_date)}`} />
              <TraceStep title="Vendido" body={`${formatKg(detail.sold_kg)} vendidos · saldo ${formatKg(detail.remaining_kg)}`} />
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void printLabel(detail)}>
                <Printer /> Etiqueta QR
              </Button>
              {isAdmin && detail.status === 'activo' && (
                <Button variant="destructive" onClick={() => setStatus.mutate({ id: detail.lot_id, status: 'bloqueado' })}>
                  Bloquear lote (retiro sanitario)
                </Button>
              )}
              {isAdmin && detail.status === 'bloqueado' && (
                <Button variant="secondary" onClick={() => setStatus.mutate({ id: detail.lot_id, status: 'activo' })}>
                  Reactivar
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <LotForm open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function TraceStep({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <li>
      <span className="absolute -left-[7px] mt-1.5 size-3 rounded-full bg-meat" />
      <p className="flex items-center gap-1.5 font-semibold">{title} {icon}</p>
      <p className="text-muted-foreground">{body}</p>
    </li>
  );
}

function ExpiryBadge({ date, status }: { date: string | null; status: LotStatus }) {
  if (status === 'agotado') return <Badge>Agotado</Badge>;
  if (status === 'bloqueado') return <Badge tone="danger">Bloqueado</Badge>;
  if (status === 'vencido') return <Badge tone="danger">Vencido</Badge>;
  const d = daysUntil(date);
  if (d === null) return <Badge tone="info">Activo</Badge>;
  if (d < 0) return <Badge tone="danger">Vencido</Badge>;
  if (d <= 2) return <Badge tone="warning">{d === 0 ? 'Vence hoy' : `${d} días`}</Badge>;
  return <Badge tone="success">{d} días</Badge>;
}

function LotForm({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: products = [] } = useAllProducts();
  const [f, setF] = useState({ product_id: '', lot_number: '', kg: '', unit_cost: '', supplier_name: '', senasa_registry: '', slaughter_date: todayISO(), expiry_date: '', storage_temp_c: '' });

  const create = useMutation({
    mutationFn: async () => {
      const kg = parseDecimal(f.kg);
      const { error } = await supabase.from('inventory_lots').insert({
        product_id: f.product_id,
        lot_number: f.lot_number.trim() || `L-${Date.now().toString(36).toUpperCase()}`,
        initial_kg: kg,
        remaining_kg: kg,
        unit_cost: parseDecimal(f.unit_cost),
        supplier_name: f.supplier_name || null,
        senasa_registry: f.senasa_registry || null,
        slaughter_date: f.slaughter_date || null,
        expiry_date: f.expiry_date || null,
        storage_temp_c: f.storage_temp_c ? parseDecimal(f.storage_temp_c) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lote ingresado; stock actualizado');
      void qc.invalidateQueries({ queryKey: ['lots'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const valid = f.product_id && parseDecimal(f.kg) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ingreso de lote"
      description="Compra directa de cortes, embutidos o menudencias"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="meat" disabled={!valid || create.isPending} onClick={() => create.mutate()}>Registrar</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Producto" className="sm:col-span-2">
          <Select value={f.product_id} onChange={set('product_id')}>
            <option value="">Seleccione…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="N° de lote" hint="Vacío = autogenerado"><Input value={f.lot_number} onChange={set('lot_number')} /></Field>
        <Field label="Cantidad (kg / und)"><Input inputMode="decimal" value={f.kg} onChange={set('kg')} className="font-mono" /></Field>
        <Field label="Costo unitario"><Input inputMode="decimal" value={f.unit_cost} onChange={set('unit_cost')} className="font-mono" /></Field>
        <Field label="Proveedor"><Input value={f.supplier_name} onChange={set('supplier_name')} /></Field>
        <Field label="Registro SENASA"><Input value={f.senasa_registry} onChange={set('senasa_registry')} /></Field>
        <Field label="Temperatura (°C)"><Input inputMode="decimal" value={f.storage_temp_c} onChange={set('storage_temp_c')} /></Field>
        <Field label="Fecha faenado / producción"><Input type="date" value={f.slaughter_date} onChange={set('slaughter_date')} /></Field>
        <Field label="Fecha de vencimiento"><Input type="date" value={f.expiry_date} onChange={set('expiry_date')} className={cn(!f.expiry_date && 'border-bone')} /></Field>
      </div>
    </Dialog>
  );
}
