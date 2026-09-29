import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Beef, CheckCircle2, ChevronRight, Lock, Plus, Save, Scale, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, Select, Stat, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { ScaleDisplay } from '@/components/ScaleDisplay';
import { useScale } from '@/hooks/ScaleProvider';
import { useAllProducts, useSettings } from '@/hooks/useCatalog';
import { computeYield } from '@/lib/yield';
import { friendlyError, supabase } from '@/lib/supabase';
import { cn, formatDate, formatKg, formatMoney, parseDecimal, round, todayISO } from '@/lib/utils';
import type { Carcass, CarcassType, CutYieldRow, Product, Species } from '@/types';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function useCarcasses() {
  return useQuery({
    queryKey: ['carcasses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('carcasses').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data as Carcass[]).map((c) => ({
        ...c,
        hook_weight_kg: Number(c.hook_weight_kg),
        total_cost: Number(c.total_cost),
        yield_pct: num(c.yield_pct),
        commercial_kg: num(c.commercial_kg),
        byproduct_kg: num(c.byproduct_kg),
        loss_kg: num(c.loss_kg),
      }));
    },
  });
}

/**
 * Motor de Despiece y Rendimiento (Yield Analytics).
 * Móvil: tarjetas por corte con botones grandes y captura desde balanza.
 * PC: matriz de alta densidad con costos prorrateados y márgenes.
 */
export function YieldPage() {
  const { data: carcasses = [], isLoading } = useCarcasses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = carcasses.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && carcasses[0]) setSelectedId(carcasses.find((c) => c.status !== 'despiezada')?.id ?? carcasses[0].id);
  }, [carcasses, selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex max-h-64 shrink-0 flex-col border-b lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-3">
          <p className="font-bold">Canales / Reses</p>
          <Button size="sm" variant="meat" onClick={() => setCreating(true)}>
            <Plus /> Recepción
          </Button>
        </div>
        <ul className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {isLoading && <li className="text-sm text-muted-foreground">Cargando…</li>}
          {!isLoading && carcasses.length === 0 && <li className="text-sm text-muted-foreground">Registre la primera recepción de canal.</li>}
          {carcasses.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedId(c.id)}
                className={cn('flex w-full items-center gap-3 rounded-lg border p-3 text-left transition', selectedId === c.id ? 'border-meat bg-meat/10' : 'hover:bg-muted')}
              >
                <Beef className={cn('size-6', c.status === 'despiezada' ? 'text-emerald-500' : 'text-bone')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.code}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.species} · {formatKg(c.hook_weight_kg)} · {formatDate(c.slaughter_date)}
                  </p>
                </div>
                {c.yield_pct !== null ? <Badge tone="success">{c.yield_pct}%</Badge> : <Badge tone="warning">Abierta</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {selected ? <YieldMatrix key={selected.id} carcass={selected} /> : <div className="p-6"><EmptyState icon={<Beef />} title="Seleccione una canal">Registre la recepción del camión frigorífico para iniciar el despiece.</EmptyState></div>}
      </section>

      <CarcassForm open={creating} onOpenChange={setCreating} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Matriz de despiece
// ---------------------------------------------------------------------
function YieldMatrix({ carcass }: { carcass: Carcass }) {
  const qc = useQueryClient();
  const scale = useScale();
  const { data: settings } = useSettings();
  const { data: products = [] } = useAllProducts();
  const symbol = settings?.currency_symbol ?? 'S/';
  const locked = carcass.status === 'despiezada';

  const { data: saved = [] } = useQuery({
    queryKey: ['cuts_yield', carcass.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cuts_yield_master').select('*').eq('carcass_id', carcass.id);
      if (error) throw error;
      return data as CutYieldRow[];
    },
  });

  // Estado editable: kg por producto
  const [kg, setKg] = useState<Record<string, string>>({});
  const [factors, setFactors] = useState<Record<string, string>>({});
  useEffect(() => {
    setKg(Object.fromEntries(saved.map((r) => [r.product_id, String(Number(r.kg_obtained))])));
    setFactors(Object.fromEntries(saved.map((r) => [r.product_id, String(Number(r.value_factor))])));
  }, [saved]);

  // Productos del catálogo que aplican a la especie (categoría) + subproductos
  const cutProducts = useMemo(() => products.filter((p) => p.active && p.unit === 'kg'), [products]);

  const result = useMemo(
    () =>
      computeYield(
        carcass.hook_weight_kg,
        carcass.total_cost,
        cutProducts
          .filter((p) => parseDecimal(kg[p.id] ?? '') > 0)
          .map((p) => ({
            product_id: p.id,
            name: p.name,
            kg: parseDecimal(kg[p.id] ?? ''),
            is_commercial: p.is_commercial_cut,
            value_factor: factors[p.id] !== undefined ? parseDecimal(factors[p.id] ?? '') : p.value_factor,
            sale_price: p.price_per_unit,
          })),
      ),
    [carcass, cutProducts, kg, factors],
  );

  const save = useMutation({
    mutationFn: async () => {
      const rows = result.rows.map((r) => ({
        carcass_id: carcass.id,
        product_id: r.product_id,
        kg_obtained: r.kg,
        is_commercial: r.is_commercial,
        value_factor: r.value_factor,
      }));
      const removed = saved.filter((s) => !rows.some((r) => r.product_id === s.product_id)).map((s) => s.product_id);
      if (removed.length) {
        const { error } = await supabase.from('cuts_yield_master').delete().eq('carcass_id', carcass.id).in('product_id', removed);
        if (error) throw error;
      }
      if (rows.length) {
        const { error } = await supabase.from('cuts_yield_master').upsert(rows, { onConflict: 'carcass_id,product_id' });
        if (error) throw error;
      }
      if (carcass.status === 'recibida') await supabase.from('carcasses').update({ status: 'en_despiece' }).eq('id', carcass.id);
    },
    onSuccess: () => {
      toast.success('Despiece guardado');
      void qc.invalidateQueries({ queryKey: ['cuts_yield', carcass.id] });
      void qc.invalidateQueries({ queryKey: ['carcasses'] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const close = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      const { data, error } = await supabase.rpc('process_carcass', { p_carcass_id: carcass.id });
      if (error) throw error;
      return data as { yield_pct: number };
    },
    onSuccess: (d) => {
      toast.success(`Despiece cerrado · Rendimiento ${d.yield_pct}% · Lotes generados`);
      void qc.invalidateQueries({ queryKey: ['carcasses'] });
      void qc.invalidateQueries({ queryKey: ['cuts_yield', carcass.id] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['lots'] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const captureFromScale = async (p: Product) => {
    try {
      const r = await scale.waitForStable();
      // Acumula: el carnicero pesa en varias bandejas
      setKg((prev) => ({ ...prev, [p.id]: String(round(parseDecimal(prev[p.id] ?? '') + r.weightKg, 3)) }));
      toast.success(`${p.name}: +${formatKg(r.weightKg)}`);
    } catch (e) {
      toast.warning((e as Error).message);
    }
  };

  const savedMap = new Map(saved.map((s) => [s.product_id, s]));
  const yieldTone = result.yield_pct >= 70 ? 'success' : result.yield_pct >= 60 ? 'warning' : 'danger';

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold">
            {carcass.code} {locked && <Lock className="size-4 text-muted-foreground" />}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Truck className="size-4" />{carcass.supplier_name}</span>
            <span>SENASA: {carcass.senasa_code ?? '—'}</span>
            <span>Faenado: {formatDate(carcass.slaughter_date)}</span>
            {carcass.arrival_temp_c !== null && <span>Temp. llegada: {carcass.arrival_temp_c}°C</span>}
          </p>
        </div>
        {!locked && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save /> Guardar
            </Button>
            <Button
              variant="meat"
              onClick={() => {
                if (confirm('¿Cerrar despiece? Se generarán los lotes y no podrá editarse.')) close.mutate();
              }}
              disabled={close.isPending || result.commercial_kg <= 0 || result.warnings.some((w) => w.includes('superan'))}
            >
              <CheckCircle2 /> Cerrar y generar lotes
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Peso en gancho" value={formatKg(carcass.hook_weight_kg)} />
        <Stat label="Costo total" value={formatMoney(carcass.total_cost, symbol)} hint={`${formatMoney(carcass.total_cost / carcass.hook_weight_kg, symbol)}/kg gancho`} />
        <Stat label="Rendimiento" value={`${result.yield_pct}%`} tone={yieldTone} hint={`${formatKg(result.commercial_kg)} comerciales`} />
        <Stat label="Subproductos" value={formatKg(result.byproduct_kg)} hint="Grasa, hueso" />
        <Stat label="Merma de proceso" value={formatKg(result.loss_kg)} tone={result.loss_pct > 5 ? 'warning' : undefined} hint={`${result.loss_pct}% (oreo, sangrado, recortes)`} />
        <Stat label="Costo real kg comercial" value={formatMoney(result.real_cost_per_commercial_kg, symbol)} hint={`Margen potencial ${formatMoney(result.potential_margin, symbol)}`} tone={result.potential_margin < 0 ? 'danger' : 'success'} />
      </div>

      {/* Barra de composición de la canal */}
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
        <motion.div className="bg-meat" animate={{ width: `${Math.min(result.yield_pct, 100)}%` }} title="Comercial" />
        <motion.div className="bg-bone" animate={{ width: `${(result.byproduct_kg / carcass.hook_weight_kg) * 100}%` }} title="Subproductos" />
        <motion.div className="bg-slate-500" animate={{ width: `${result.loss_pct}%` }} title="Merma" />
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-bone/40 bg-bone/10 p-3 text-sm font-medium text-bone-dark dark:text-bone">
          {result.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      {!locked && <ScaleDisplay symbol={symbol} compact className="md:max-w-md" />}

      {/* Móvil: tarjetas por corte */}
      <div className="grid gap-2 md:hidden">
        {cutProducts.map((p) => {
          const r = result.rows.find((x) => x.product_id === p.id);
          return (
            <Card key={p.id} className={cn('p-3', !p.is_commercial_cut && 'border-dashed')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r ? `${r.pct_of_carcass}% · ${formatMoney(r.cost_per_kg, symbol)}/kg` : p.is_commercial_cut ? 'Corte comercial' : 'Subproducto'}
                  </p>
                </div>
                <Input
                  inputMode="decimal"
                  disabled={locked}
                  className="h-12 w-28 text-right font-mono text-lg"
                  placeholder="0.000"
                  value={kg[p.id] ?? ''}
                  onChange={(e) => setKg({ ...kg, [p.id]: e.target.value })}
                />
                {!locked && scale.status === 'connected' && (
                  <Button size="icon" variant="bone" onClick={() => void captureFromScale(p)} aria-label="Pesar">
                    <Scale />
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* PC/Tablet: matriz de alta densidad */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>Corte</th>
              <th>Tipo</th>
              <th className="text-right">Kg obtenidos</th>
              <th className="text-right">% canal</th>
              <th className="text-right">Factor valor</th>
              <th className="text-right">Costo asignado</th>
              <th className="text-right">Costo/kg</th>
              <th className="text-right">Precio venta</th>
              <th className="text-right">Margen</th>
              {locked && <th>Lote</th>}
            </tr>
          </thead>
          <tbody>
            {cutProducts.map((p) => {
              const r = result.rows.find((x) => x.product_id === p.id);
              const s = savedMap.get(p.id);
              return (
                <tr key={p.id} className={cn(!p.is_commercial_cut && 'text-muted-foreground')}>
                  <td className="font-semibold">{p.name}</td>
                  <td>{p.is_commercial_cut ? <Badge tone="danger">Comercial</Badge> : <Badge>Subproducto</Badge>}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={kg[p.id] ?? ''}
                        placeholder="0.000"
                        onChange={(e) => setKg({ ...kg, [p.id]: e.target.value })}
                        className="h-9 w-24 rounded-md border bg-background px-2 text-right font-mono"
                      />
                      {!locked && scale.status === 'connected' && (
                        <button onClick={() => void captureFromScale(p)} className="grid size-9 place-items-center rounded-md bg-bone text-burgundy-950" title="Sumar peso de balanza">
                          <Scale className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="text-right">{r ? `${r.pct_of_carcass}%` : '—'}</td>
                  <td className="text-right">
                    {p.is_commercial_cut ? (
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={factors[p.id] ?? String(p.value_factor)}
                        onChange={(e) => setFactors({ ...factors, [p.id]: e.target.value })}
                        className="h-9 w-16 rounded-md border bg-background px-2 text-right font-mono"
                      />
                    ) : '—'}
                  </td>
                  <td className="text-right">{r ? formatMoney(locked && s?.allocated_cost != null ? Number(s.allocated_cost) : r.allocated_cost, symbol) : '—'}</td>
                  <td className="text-right font-semibold">{r ? formatMoney(r.cost_per_kg, symbol) : '—'}</td>
                  <td className="text-right">{formatMoney(p.price_per_unit, symbol)}</td>
                  <td className={cn('text-right font-semibold', r?.margin_pct != null && r.margin_pct < 0 ? 'text-meat' : 'text-emerald-600 dark:text-emerald-400')}>
                    {r?.margin_pct != null && p.is_commercial_cut ? `${r.margin_pct}%` : '—'}
                  </td>
                  {locked && <td className="font-mono text-xs">{s?.lot_id ? '✓' : ''}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={2} className="border-t px-3 py-2">Total pesado</td>
              <td className="border-t px-3 py-2 text-right">{formatKg(result.weighed_kg)}</td>
              <td className="border-t px-3 py-2 text-right">{round((result.weighed_kg / carcass.hook_weight_kg) * 100, 2)}%</td>
              <td className="border-t" />
              <td className="border-t px-3 py-2 text-right">{formatMoney(carcass.total_cost, symbol)}</td>
              <td colSpan={locked ? 4 : 3} className="border-t" />
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Recepción de canal (camión frigorífico / proveedor)
// ---------------------------------------------------------------------
function CarcassForm({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const scale = useScale();
  const empty = {
    code: '', species: 'res' as Species, carcass_type: 'entera' as CarcassType, supplier_name: '', supplier_tax_id: '',
    truck_plate: '', guide_number: '', senasa_code: '', slaughter_date: todayISO(), arrival_temp_c: '',
    hook_weight_kg: '', total_cost: '', shelf_life_days: '7', notes: '',
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (open) setF({ ...empty, code: `R-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 90 + 10)}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const temp = f.arrival_temp_c ? parseDecimal(f.arrival_temp_c) : null;
      const { data, error } = await supabase
        .from('carcasses')
        .insert({
          code: f.code.trim(), species: f.species, carcass_type: f.carcass_type, supplier_name: f.supplier_name.trim(),
          supplier_tax_id: f.supplier_tax_id || null, truck_plate: f.truck_plate || null, guide_number: f.guide_number || null,
          senasa_code: f.senasa_code || null, slaughter_date: f.slaughter_date, arrival_temp_c: temp,
          hook_weight_kg: parseDecimal(f.hook_weight_kg), total_cost: parseDecimal(f.total_cost),
          shelf_life_days: Number(f.shelf_life_days) || 7, notes: f.notes || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success('Canal registrada');
      void qc.invalidateQueries({ queryKey: ['carcasses'] });
      onCreated(id);
      onOpenChange(false);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const tempAlert = f.arrival_temp_c !== '' && parseDecimal(f.arrival_temp_c) > 7;
  const valid = f.code && f.supplier_name && parseDecimal(f.hook_weight_kg) > 0 && parseDecimal(f.total_cost) >= 0 && f.slaughter_date;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recepción de canal"
      description="Trazabilidad desde el camión frigorífico"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="meat" disabled={!valid || create.isPending} onClick={() => create.mutate()}>Registrar</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código / tropa"><Input value={f.code} onChange={set('code')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Especie">
            <Select value={f.species} onChange={set('species')}>
              <option value="res">Res</option><option value="cerdo">Cerdo</option><option value="cordero">Cordero</option><option value="pollo">Pollo</option><option value="otro">Otro</option>
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={f.carcass_type} onChange={set('carcass_type')}>
              <option value="entera">Entera</option><option value="media">Media res</option><option value="cuarto_delantero">Cuarto delantero</option><option value="cuarto_trasero">Cuarto trasero</option>
            </Select>
          </Field>
        </div>
        <Field label="Proveedor / frigorífico"><Input value={f.supplier_name} onChange={set('supplier_name')} /></Field>
        <Field label="RUC proveedor"><Input inputMode="numeric" value={f.supplier_tax_id} onChange={set('supplier_tax_id')} /></Field>
        <Field label="Placa camión"><Input value={f.truck_plate} onChange={set('truck_plate')} className="uppercase" /></Field>
        <Field label="Guía de remisión"><Input value={f.guide_number} onChange={set('guide_number')} /></Field>
        <Field label="Certificado SENASA"><Input value={f.senasa_code} onChange={set('senasa_code')} /></Field>
        <Field label="Fecha de faenado"><Input type="date" value={f.slaughter_date} onChange={set('slaughter_date')} /></Field>
        <Field label="Peso en gancho (kg)">
          <div className="flex gap-2">
            <Input inputMode="decimal" value={f.hook_weight_kg} onChange={set('hook_weight_kg')} className="font-mono" />
            {scale.status === 'connected' && (
              <Button variant="bone" size="icon" onClick={() => scale.waitForStable().then((r) => setF((x) => ({ ...x, hook_weight_kg: String(r.weightKg) }))).catch((e: Error) => toast.warning(e.message))}>
                <Scale />
              </Button>
            )}
          </div>
        </Field>
        <Field label="Costo total"><Input inputMode="decimal" value={f.total_cost} onChange={set('total_cost')} className="font-mono" /></Field>
        <Field label="Temperatura llegada (°C)" hint={tempAlert ? '⚠ Cadena de frío comprometida (> 7 °C)' : 'Refrigerado: 0 a 7 °C'}>
          <Input inputMode="decimal" value={f.arrival_temp_c} onChange={set('arrival_temp_c')} className={cn(tempAlert && 'border-meat ring-1 ring-meat')} />
        </Field>
        <Field label="Vida útil (días)"><Input inputMode="numeric" value={f.shelf_life_days} onChange={set('shelf_life_days')} /></Field>
        <Field label="Observaciones" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Dialog>
  );
}

