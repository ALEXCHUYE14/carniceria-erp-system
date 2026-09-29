import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, CloudOff, Loader2, Lock, LockOpen, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, Select, Stat, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { useSettings } from '@/hooks/useCatalog';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { useSyncStore } from '@/stores/syncStore';
import { friendlyError, supabase } from '@/lib/supabase';
import { cn, formatDate, formatMoney, parseDecimal, round } from '@/lib/utils';
import { METHOD_LABEL } from '@/features/pos/checkout';
import type { CashMovement, CashMovementKind, CashSession, CashSummary, PaymentMethod } from '@/types';
import { cashKeys, normalizeSession, useCashSummary, useCurrentCashSession } from './useCashSession';

const METHODS: PaymentMethod[] = ['efectivo', 'yape', 'plin', 'tarjeta', 'credito'];

/**
 * Arqueo de caja: apertura con fondo inicial, cobros por método, ingresos/retiros de efectivo
 * y cierre con conteo físico (diferencia = contado − esperado).
 */
export function CashPage() {
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';
  const terminalId = useDeviceStore((s) => s.terminalId);
  const online = useSyncStore((s) => s.online);
  const { data: current, isLoading } = useCurrentCashSession(terminalId);

  if (!online) {
    return (
      <div className="p-4">
        <EmptyState icon={<CloudOff className="size-10" />} title="Arqueo sin conexión">
          La apertura y el cierre de caja requieren conexión. Las ventas offline se suman al turno cuando se sincronizan.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="size-5 text-meat" />
        <h2 className="text-lg font-bold">Caja {terminalId}</h2>
        {current?.session ? <Badge tone="success">Turno abierto</Badge> : <Badge tone="warning">Cerrada</Badge>}
        <span className="text-xs text-muted-foreground">(el identificador se cambia en Ajustes → Dispositivos)</span>
      </div>

      {isLoading ? (
        <Loader2 className="size-8 animate-spin text-meat" />
      ) : current?.session ? (
        <OpenSession session={current.session} symbol={symbol} />
      ) : (
        <OpenForm terminalId={terminalId} symbol={symbol} />
      )}

      <History symbol={symbol} />
    </div>
  );
}

// ---------------------------------------------------------------------
function OpenForm({ terminalId, symbol }: { terminalId: string; symbol: string }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const open = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('open_cash_session', { p_terminal_id: terminalId, p_opening_amount: parseDecimal(amount) });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Turno de caja abierto');
      setAmount('');
      void qc.invalidateQueries({ queryKey: cashKeys.current(terminalId) });
      void qc.invalidateQueries({ queryKey: cashKeys.history });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Abrir turno</CardTitle>
        <CardDescription>Cuente el sencillo con el que empieza la caja. Mientras no haya turno abierto no se puede cobrar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label={`Fondo inicial (${symbol})`}>
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right text-xl tabular-nums" />
        </Field>
        <Button variant="meat" className="w-full" disabled={open.isPending} onClick={() => open.mutate()}>
          {open.isPending ? <Loader2 className="animate-spin" /> : <LockOpen />} Abrir caja
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
function OpenSession({ session, symbol }: { session: CashSession; symbol: string }) {
  const { data: summary, isLoading } = useCashSummary(session.id);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<CashSummary | null>(null);

  if (isLoading || !summary) return <Loader2 className="size-8 animate-spin text-meat" />;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Apertura" value={formatDate(session.opened_at, true)} hint={`Fondo ${formatMoney(session.opening_amount, symbol)}`} />
        <Stat label="Ventas" value={formatMoney(Number(summary.sales_total), symbol)} hint={`${summary.sales_count} tickets · ${summary.voided_count} anuladas`} />
        <Stat label="Ingresos / retiros" value={`${formatMoney(Number(summary.cash_in), symbol)} / ${formatMoney(Number(summary.cash_out), symbol)}`} />
        <Stat label="Efectivo esperado" value={formatMoney(Number(summary.expected_cash), symbol)} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MethodsCard summary={summary} symbol={symbol} />
        <MovementsCard sessionId={session.id} symbol={symbol} />
      </div>

      <Button variant="burgundy" size="lg" onClick={() => setClosing(true)}>
        <Lock /> Cerrar turno y arquear
      </Button>

      <CloseDialog
        open={closing}
        onOpenChange={setClosing}
        session={session}
        expected={Number(summary.expected_cash)}
        symbol={symbol}
        onClosed={(r) => {
          setClosing(false);
          setClosed(r);
        }}
      />
      <Dialog open={!!closed} onOpenChange={(v) => !v && setClosed(null)} title="Caja cerrada" size="sm">
        {closed && <CloseResult summary={closed} symbol={symbol} />}
      </Dialog>
    </>
  );
}

function MethodsCard({ summary, symbol }: { summary: CashSummary; symbol: string }) {
  const sale = (m: PaymentMethod) => Number(summary.sales_by_method[m] ?? 0);
  const abono = (m: PaymentMethod) => Number(summary.abonos_by_method[m] ?? 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobros por método</CardTitle>
        <CardDescription>Fiado no es dinero en caja: se muestra solo como referencia.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1">Método</th><th className="text-right">Ventas</th><th className="text-right">Abonos</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y tabular-nums">
            {METHODS.map((m) => (
              <tr key={m} className={cn(m === 'credito' && 'text-muted-foreground')}>
                <td className="py-2 font-semibold">{METHOD_LABEL[m]}</td>
                <td className="text-right">{formatMoney(sale(m), symbol)}</td>
                <td className="text-right">{m === 'credito' ? '—' : formatMoney(abono(m), symbol)}</td>
                <td className="text-right font-semibold">{formatMoney(round(sale(m) + abono(m), 2), symbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function MovementsCard({ sessionId, symbol }: { sessionId: string; symbol: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<CashMovementKind>('egreso');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const { data: movements = [] } = useQuery({
    queryKey: cashKeys.movements(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_movements').select('*').eq('session_id', sessionId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data as CashMovement[]).map((m) => ({ ...m, amount: Number(m.amount) }));
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('add_cash_movement', {
        p_session_id: sessionId, p_kind: kind, p_amount: parseDecimal(amount), p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(kind === 'egreso' ? 'Retiro registrado' : 'Ingreso registrado');
      setAmount('');
      setReason('');
      void qc.invalidateQueries({ queryKey: cashKeys.movements(sessionId) });
      void qc.invalidateQueries({ queryKey: cashKeys.summary(sessionId) });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimientos de efectivo</CardTitle>
        <CardDescription>Retiros (pago a proveedor, gastos, depósito) o ingresos de sencillo durante el turno.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as CashMovementKind)} className="h-12">
            <option value="egreso">Retiro</option>
            <option value="ingreso">Ingreso</option>
          </Select>
          <Input inputMode="decimal" placeholder={`Monto ${symbol}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
          <Button variant="secondary" disabled={add.isPending || parseDecimal(amount) <= 0 || !reason.trim()} onClick={() => add.mutate()}>
            Registrar
          </Button>
        </div>
        {movements.length > 0 && (
          <ul className="divide-y text-sm">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                {m.kind === 'egreso' ? <ArrowUpCircle className="size-4 text-meat" /> : <ArrowDownCircle className="size-4 text-emerald-500" />}
                <span className="flex-1 truncate">{m.reason}</span>
                <span className="text-xs text-muted-foreground">{formatDate(m.created_at, true)}</span>
                <span className={cn('font-semibold tabular-nums', m.kind === 'egreso' ? 'text-meat' : 'text-emerald-600')}>
                  {m.kind === 'egreso' ? '−' : '+'}{formatMoney(m.amount, symbol)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CloseDialog({
  open, onOpenChange, session, expected, symbol, onClosed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  session: CashSession;
  expected: number;
  symbol: string;
  onClosed: (r: CashSummary) => void;
}) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const countedValue = parseDecimal(counted);
  const diff = round(countedValue - expected, 2);

  const close = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('close_cash_session', {
        p_session_id: session.id, p_counted_cash: countedValue, p_notes: notes.trim() || null,
      });
      if (error) throw error;
      return data as CashSummary;
    },
    onSuccess: (r) => {
      setCounted('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: cashKeys.current(session.terminal_id) });
      void qc.invalidateQueries({ queryKey: cashKeys.history });
      onClosed(r);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cerrar turno"
      description={`Efectivo esperado: ${formatMoney(expected, symbol)}`}
      size="sm"
      footer={
        <Button variant="burgundy" className="w-full" size="lg" disabled={close.isPending || counted.trim() === ''} onClick={() => close.mutate()}>
          {close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} Confirmar cierre
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={`Efectivo contado en caja (${symbol})`} hint="Cuente billetes y monedas, incluido el fondo inicial.">
          <Input inputMode="decimal" placeholder="0.00" value={counted} onChange={(e) => setCounted(e.target.value)} className="text-right text-2xl tabular-nums" autoFocus />
        </Field>
        {counted.trim() !== '' && <DifferenceBadge diff={diff} symbol={symbol} />}
        <Field label="Observaciones">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional: explique faltantes o sobrantes" />
        </Field>
      </div>
    </Dialog>
  );
}

function DifferenceBadge({ diff, symbol }: { diff: number; symbol: string }) {
  if (Math.abs(diff) < 0.005) return <p className="rounded-lg bg-emerald-500/15 p-3 text-center font-bold text-emerald-600">Caja cuadrada</p>;
  return (
    <p className={cn('rounded-lg p-3 text-center font-bold', diff < 0 ? 'bg-meat/15 text-meat' : 'bg-sky-500/15 text-sky-600')}>
      {diff < 0 ? 'Faltante' : 'Sobrante'}: {formatMoney(Math.abs(diff), symbol)}
    </p>
  );
}

function CloseResult({ summary, symbol }: { summary: CashSummary; symbol: string }) {
  const diff = Number(summary.difference ?? 0);
  return (
    <div className="space-y-2 text-sm">
      <Row label="Fondo inicial" value={formatMoney(Number(summary.opening_amount), symbol)} />
      <Row label="Ventas en efectivo" value={formatMoney(Number(summary.sales_by_method.efectivo ?? 0), symbol)} />
      <Row label="Abonos en efectivo" value={formatMoney(Number(summary.abonos_by_method.efectivo ?? 0), symbol)} />
      <Row label="Ingresos − retiros" value={formatMoney(Number(summary.cash_in) - Number(summary.cash_out), symbol)} />
      <Row label="Esperado" value={formatMoney(Number(summary.expected_cash), symbol)} bold />
      <Row label="Contado" value={formatMoney(Number(summary.counted_cash ?? 0), symbol)} bold />
      <DifferenceBadge diff={diff} symbol={symbol} />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex justify-between', bold && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
function History({ symbol }: { symbol: string }) {
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  const { data: sessions = [] } = useQuery({
    queryKey: cashKeys.history,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('status', 'cerrada')
        .order('opened_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data as CashSession[]).map(normalizeSession);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Turnos cerrados</CardTitle>
        <CardDescription>{isAdmin ? 'Últimos 30 turnos de todas las cajas.' : 'Tus últimos turnos.'}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay turnos cerrados.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Caja</th><th>Apertura</th><th>Cierre</th>
                <th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {sessions.map((s) => {
                const diff = s.difference ?? 0;
                return (
                  <tr key={s.id} title={s.notes ?? undefined}>
                    <td className="py-2 font-semibold">{s.terminal_id}</td>
                    <td>{formatDate(s.opened_at, true)}</td>
                    <td>{formatDate(s.closed_at, true)}</td>
                    <td className="text-right">{formatMoney(s.expected_cash ?? 0, symbol)}</td>
                    <td className="text-right">{formatMoney(s.counted_cash ?? 0, symbol)}</td>
                    <td className={cn('text-right font-bold', diff < -0.005 ? 'text-meat' : diff > 0.005 ? 'text-sky-600' : 'text-emerald-600')}>
                      {formatMoney(diff, symbol)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
