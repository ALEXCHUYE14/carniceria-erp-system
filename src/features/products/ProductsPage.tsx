import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Scissors, Tags } from 'lucide-react';
import { toast } from 'sonner';
import * as Tabs from '@radix-ui/react-tabs';
import { Button } from '@/components/ui/button';
import { Badge, Card, Field, Input, Select } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { useAllProducts, useSettings } from '@/hooks/useCatalog';
import { friendlyError, supabase } from '@/lib/supabase';
import { cn, formatKg, formatMoney, parseDecimal } from '@/lib/utils';
import type { Category, CutType, Product } from '@/types';

const tabCls =
  'flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow';

/** Mantenimiento de catálogo (solo administrador). */
export function ProductsPage() {
  return (
    <Tabs.Root defaultValue="products" className="space-y-4 p-3 md:p-4">
      <Tabs.List className="inline-flex gap-1 rounded-xl bg-muted p-1">
        <Tabs.Trigger value="products" className={tabCls}><Package className="size-4" /> Productos</Tabs.Trigger>
        <Tabs.Trigger value="categories" className={tabCls}><Tags className="size-4" /> Categorías</Tabs.Trigger>
        <Tabs.Trigger value="cuts" className={tabCls}><Scissors className="size-4" /> Cortes y mermas</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="products"><ProductsTab /></Tabs.Content>
      <Tabs.Content value="categories"><CategoriesTab /></Tabs.Content>
      <Tabs.Content value="cuts"><CutTypesTab /></Tabs.Content>
    </Tabs.Root>
  );
}

function useAllCategories() {
  return useQuery({
    queryKey: ['categories', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('sort_order');
      if (error) throw error;
      return data as Category[];
    },
  });
}

function ProductsTab() {
  const { data: products = [] } = useAllProducts();
  const { data: categories = [] } = useAllCategories();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [q, setQ] = useState('');

  const filtered = products.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.toLowerCase().includes(q.toLowerCase()));
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button variant="meat" onClick={() => setEditing({ sell_by_weight: true, unit: 'kg', is_commercial_cut: true, value_factor: 1, weight_shortcuts: [0.25, 0.5, 1], active: true })}>
          <Plus /> Producto
        </Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>Producto</th><th>SKU / Código</th><th>Categoría</th><th className="text-right">Precio</th><th className="text-right">Costo pond.</th><th className="text-right">Margen</th><th className="text-right">Stock</th><th>Tipo</th><th /></tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const margin = p.price_per_unit > 0 ? ((p.price_per_unit - p.cost_per_unit) / p.price_per_unit) * 100 : 0;
              return (
                <tr key={p.id} className={cn(!p.active && 'opacity-50')}>
                  <td className="font-semibold">{p.name}</td>
                  <td className="font-mono text-xs">{p.sku ?? '—'}<br />{p.barcode ?? ''}</td>
                  <td>{catName(p.category_id)}</td>
                  <td className="text-right">{formatMoney(p.price_per_unit, symbol)}/{p.unit}</td>
                  <td className="text-right">{formatMoney(p.cost_per_unit, symbol)}</td>
                  <td className={cn('text-right font-semibold', margin < 15 ? 'text-meat' : 'text-emerald-600 dark:text-emerald-400')}>{p.cost_per_unit > 0 ? `${margin.toFixed(1)}%` : '—'}</td>
                  <td className={cn('text-right', p.stock_actual_kg <= p.min_stock_kg && 'font-bold text-meat')}>{formatKg(p.stock_actual_kg, p.unit)}</td>
                  <td>{p.is_commercial_cut ? <Badge tone="danger">Comercial ×{p.value_factor}</Badge> : <Badge>Subproducto</Badge>}</td>
                  <td>
                    <button onClick={() => setEditing(p)} className="rounded p-1.5 hover:bg-muted" aria-label="Editar"><Pencil className="size-4" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {editing && <ProductForm key={editing.id ?? 'new'} initial={editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProductForm({ initial, categories, onClose }: { initial: Partial<Product>; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: initial.name ?? '',
    sku: initial.sku ?? '',
    barcode: initial.barcode ?? '',
    category_id: initial.category_id ?? '',
    unit: initial.unit ?? 'kg',
    price_per_unit: String(initial.price_per_unit ?? ''),
    min_stock_kg: String(initial.min_stock_kg ?? '0'),
    value_factor: String(initial.value_factor ?? '1'),
    is_commercial_cut: initial.is_commercial_cut ?? true,
    weight_shortcuts: (initial.weight_shortcuts ?? []).join(', '),
    image_url: initial.image_url ?? '',
    active: initial.active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: f.name.trim(),
        sku: f.sku.trim() || null,
        barcode: f.barcode.trim() || null,
        category_id: f.category_id || null,
        unit: f.unit,
        sell_by_weight: f.unit === 'kg',
        price_per_unit: parseDecimal(f.price_per_unit),
        min_stock_kg: parseDecimal(f.min_stock_kg),
        value_factor: parseDecimal(f.value_factor),
        is_commercial_cut: f.is_commercial_cut,
        weight_shortcuts: f.weight_shortcuts.split(',').map((s) => parseDecimal(s)).filter((n) => n > 0),
        image_url: f.image_url.trim() || null,
        active: f.active,
      };
      const { error } = initial.id ? await supabase.from('products').update(row).eq('id', initial.id) : await supabase.from('products').insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Producto guardado');
      void qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={initial.id ? 'Editar producto' : 'Nuevo producto'} size="lg" footer={<Button variant="meat" disabled={!f.name || save.isPending} onClick={() => save.mutate()}>Guardar</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="SKU"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Código de barras (EAN / PLU balanza)"><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
        <Field label="Categoría">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Unidad de venta">
          <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as 'kg' | 'und' })}>
            <option value="kg">Por peso (kg)</option>
            <option value="und">Por unidad</option>
          </Select>
        </Field>
        <Field label="Precio de venta"><Input inputMode="decimal" value={f.price_per_unit} onChange={(e) => setF({ ...f, price_per_unit: e.target.value })} /></Field>
        <Field label="Stock mínimo (alerta)"><Input inputMode="decimal" value={f.min_stock_kg} onChange={(e) => setF({ ...f, min_stock_kg: e.target.value })} /></Field>
        <Field label="Atajos de peso (kg, separados por coma)" hint="Ej: 0.25, 0.5, 1"><Input value={f.weight_shortcuts} onChange={(e) => setF({ ...f, weight_shortcuts: e.target.value })} /></Field>
        <Field label="Factor de valor comercial" hint="Prorrateo de costo en despiece (lomo 3.0, pecho 1.0)"><Input inputMode="decimal" value={f.value_factor} onChange={(e) => setF({ ...f, value_factor: e.target.value })} /></Field>
        <Field label="URL de imagen" className="sm:col-span-2"><Input value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} /></Field>
        <label className="flex items-center gap-3 rounded-lg border p-3">
          <input type="checkbox" className="size-5 accent-[#DC2626]" checked={f.is_commercial_cut} onChange={(e) => setF({ ...f, is_commercial_cut: e.target.checked })} />
          <span className="text-sm font-semibold">Corte comercial (cuenta para rendimiento)</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border p-3">
          <input type="checkbox" className="size-5 accent-[#DC2626]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          <span className="text-sm font-semibold">Activo en caja</span>
        </label>
      </div>
    </Dialog>
  );
}

function CategoriesTab() {
  const qc = useQueryClient();
  const { data: categories = [] } = useAllCategories();
  const [name, setName] = useState('');

  const upsert = async (row: Partial<Category>) => {
    const { error } = row.id ? await supabase.from('categories').update(row).eq('id', row.id) : await supabase.from('categories').insert(row);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ['categories'] });
  };

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Nueva categoría" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="meat" disabled={!name.trim()} onClick={() => { void upsert({ name: name.trim(), sort_order: categories.length + 1 }); setName(''); }}><Plus /> Agregar</Button>
      </div>
      <Card className="divide-y">
        {categories.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 p-3">
            <Input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void upsert({ id: c.id, name: e.target.value })} className="h-10 max-w-48" />
            <Input defaultValue={c.image_url ?? ''} placeholder="URL imagen HD" onBlur={(e) => e.target.value !== (c.image_url ?? '') && void upsert({ id: c.id, image_url: e.target.value || null })} className="h-10 flex-1" />
            <Input type="number" defaultValue={c.sort_order} onBlur={(e) => Number(e.target.value) !== c.sort_order && void upsert({ id: c.id, sort_order: Number(e.target.value) })} className="h-10 w-20" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.active} onChange={(e) => void upsert({ id: c.id, active: e.target.checked })} className="size-4" /> Activa
            </label>
          </div>
        ))}
      </Card>
    </div>
  );
}

function CutTypesTab() {
  const qc = useQueryClient();
  const { data: cuts = [] } = useQuery({
    queryKey: ['cut_types', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cut_types').select('*').order('sort_order');
      if (error) throw error;
      return data as CutType[];
    },
  });

  const upsert = async (row: Partial<CutType>) => {
    const { error } = row.id ? await supabase.from('cut_types').update(row).eq('id', row.id) : await supabase.from('cut_types').insert(row);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ['cut_types'] });
  };

  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-sm text-muted-foreground">
        La <b>merma %</b> es el peso extra que sale de inventario para entregar 1 kg neto preparado (ej. molida especial 4%: para 1 kg se descuentan 1.042 kg).
        El <b>recargo</b> se cobra por kg preparado.
      </p>
      <Button variant="meat" onClick={() => void upsert({ name: `Nuevo corte ${cuts.length + 1}`, shrink_pct: 0, surcharge_per_kg: 0, sort_order: cuts.length + 1 })}>
        <Plus /> Tipo de corte
      </Button>
      <Card className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Nombre</th><th>Merma %</th><th>Recargo/kg</th><th>Orden</th><th>Activo</th></tr></thead>
          <tbody>
            {cuts.map((c) => (
              <tr key={c.id}>
                <td><input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void upsert({ id: c.id, name: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2" /></td>
                <td><input defaultValue={c.shrink_pct} inputMode="decimal" onBlur={(e) => void upsert({ id: c.id, shrink_pct: parseDecimal(e.target.value) })} className="h-9 w-20 rounded-md border bg-background px-2 text-right" /></td>
                <td><input defaultValue={c.surcharge_per_kg} inputMode="decimal" onBlur={(e) => void upsert({ id: c.id, surcharge_per_kg: parseDecimal(e.target.value) })} className="h-9 w-20 rounded-md border bg-background px-2 text-right" /></td>
                <td><input defaultValue={c.sort_order} type="number" onBlur={(e) => void upsert({ id: c.id, sort_order: Number(e.target.value) })} className="h-9 w-16 rounded-md border bg-background px-2 text-right" /></td>
                <td><input type="checkbox" checked={c.active} onChange={(e) => void upsert({ id: c.id, active: e.target.checked })} className="size-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
