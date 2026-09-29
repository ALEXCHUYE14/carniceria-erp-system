import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Stat } from '@/components/ui/primitives';
import { useSettings } from '@/hooks/useCatalog';
import { supabase } from '@/lib/supabase';
import { formatKg, formatMoney, round } from '@/lib/utils';
import type { CarcassYieldView, DailySales } from '@/types';

const COLORS = { meat: '#DC2626', burgundy: '#4A0E17', bone: '#F59E0B', ok: '#10B981', grid: 'rgba(148,163,184,0.25)' };

/** Panel de control de planta: ventas, rendimiento por canal y balance de pérdidas en tiempo real. */
export function DashboardPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';

  const { data: daily = [] } = useQuery({
    queryKey: ['dash', 'daily'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase.from('v_daily_sales').select('*').gte('day', since).order('day');
      if (error) throw error;
      return (data as DailySales[]).map((d) => ({
        ...d,
        total: Number(d.total),
        cost: Number(d.cost),
        margin: round(Number(d.total) - Number(d.cost), 2),
        label: d.day.slice(5),
      }));
    },
  });

  const { data: yields = [] } = useQuery({
    queryKey: ['dash', 'yield'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_carcass_yield').select('*').eq('status', 'despiezada').order('processed_at', { ascending: false }).limit(20);
      if (error) throw error;
      return (data as CarcassYieldView[])
        .map((c) => ({
          ...c,
          yield_pct: Number(c.yield_pct),
          hook_weight_kg: Number(c.hook_weight_kg),
          loss_kg: Number(c.loss_kg),
          byproduct_kg: Number(c.byproduct_kg),
          commercial_kg: Number(c.commercial_kg),
          real_cost_per_commercial_kg: Number(c.real_cost_per_commercial_kg),
        }))
        .reverse();
    },
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ['dash', 'low'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_low_stock').select('*').order('stock_actual_kg');
      if (error) throw error;
      return data as Array<{ id: string; name: string; stock_actual_kg: number; min_stock_kg: number }>;
    },
  });

  const { data: shrink } = useQuery({
    queryKey: ['dash', 'shrink'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase.from('sale_items').select('shrink_kg, unit_cost, sales!inner(status)').gte('created_at', since).eq('sales.status', 'completada');
      if (error) throw error;
      const rows = data as unknown as Array<{ shrink_kg: number; unit_cost: number }>;
      return {
        kg: rows.reduce((a, r) => a + Number(r.shrink_kg), 0),
        cost: rows.reduce((a, r) => a + Number(r.shrink_kg) * Number(r.unit_cost), 0),
      };
    },
  });

  // Tiempo real: cualquier venta en cualquier caja refresca el panel
  useEffect(() => {
    const ch = supabase
      .channel('dashboard-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        void qc.invalidateQueries({ queryKey: ['dash'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const today = daily.at(-1);
  const month = daily.reduce((a, d) => a + d.total, 0);
  const monthMargin = daily.reduce((a, d) => a + d.margin, 0);
  const avgYield = yields.length ? round(yields.reduce((a, y) => a + y.yield_pct, 0) / yields.length, 2) : 0;
  const processLoss = yields.reduce((a, y) => a + y.loss_kg, 0);
  const processLossCost = yields.reduce((a, y) => a + y.loss_kg * (y.total_cost / y.hook_weight_kg), 0);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Venta hoy" value={formatMoney(today?.total ?? 0, symbol)} hint={`${today?.tickets ?? 0} tickets`} />
        <Stat label="Venta 30 días" value={formatMoney(month, symbol)} />
        <Stat label="Margen bruto 30d" value={formatMoney(monthMargin, symbol)} tone={monthMargin >= 0 ? 'success' : 'danger'} hint={month ? `${round((monthMargin / month) * 100, 1)}%` : undefined} />
        <Stat label="Rendimiento promedio" value={`${avgYield}%`} tone={avgYield >= 70 ? 'success' : 'warning'} hint={`${yields.length} canales`} />
        <Stat label="Merma de proceso" value={formatKg(processLoss)} tone="warning" hint={formatMoney(processLossCost, symbol)} />
        <Stat label="Merma preparación 30d" value={formatKg(shrink?.kg ?? 0)} tone="warning" hint={formatMoney(shrink?.cost ?? 0, symbol)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ventas vs costo — últimos 30 días</CardTitle>
            <CardDescription>Se actualiza en vivo con cada venta</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(v) => formatMoney(Number(v ?? 0), symbol)} />
                <Line type="monotone" dataKey="total" name="Venta" stroke={COLORS.meat} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="cost" name="Costo" stroke={COLORS.bone} strokeWidth={2} dot={false} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rendimiento por canal</CardTitle>
            <CardDescription>Meta referencial 70% (res)</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yields}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="code" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={40} unit="%" />
                <Tooltip formatter={(v) => `${String(v ?? 0)}%`} />
                <ReferenceLine y={70} stroke={COLORS.ok} strokeDasharray="4 4" />
                <Bar dataKey="yield_pct" name="Rendimiento" radius={[4, 4, 0, 0]}>
                  {yields.map((y) => (
                    <Cell key={y.id} fill={y.yield_pct >= 70 ? COLORS.burgundy : y.yield_pct >= 60 ? COLORS.bone : COLORS.meat} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>Balance de pérdidas por canal</CardTitle>
          </CardHeader>
          <table className="data-table">
            <thead>
              <tr>
                <th>Canal</th><th>Proveedor</th><th className="text-right">Gancho</th><th className="text-right">Comercial</th>
                <th className="text-right">Subprod.</th><th className="text-right">Merma</th><th className="text-right">Rend.</th><th className="text-right">Costo real/kg</th>
              </tr>
            </thead>
            <tbody>
              {[...yields].reverse().map((y) => (
                <tr key={y.id}>
                  <td className="font-mono font-semibold">{y.code}</td>
                  <td>{y.supplier_name}</td>
                  <td className="text-right">{y.hook_weight_kg.toFixed(1)}</td>
                  <td className="text-right">{y.commercial_kg.toFixed(1)}</td>
                  <td className="text-right">{y.byproduct_kg.toFixed(1)}</td>
                  <td className="text-right text-bone-dark dark:text-bone">{y.loss_kg.toFixed(1)}</td>
                  <td className="text-right font-bold">{y.yield_pct}%</td>
                  <td className="text-right">{formatMoney(y.real_cost_per_commercial_kg, symbol)}</td>
                </tr>
              ))}
              {yields.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Aún no hay despieces cerrados</td></tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-bone" /> Stock bajo mínimo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {lowStock.map((p) => (
                <li key={p.id} className="flex justify-between py-2">
                  <span>{p.name}</span>
                  <span className="font-semibold tabular-nums text-meat">
                    {Number(p.stock_actual_kg).toFixed(2)} / {Number(p.min_stock_kg).toFixed(2)} kg
                  </span>
                </li>
              ))}
              {lowStock.length === 0 && <li className="py-4 text-center text-muted-foreground">Todo en orden</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
