import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Banknote, CreditCard, HandCoins, Loader2, QrCode, Smartphone, Trash2, UserRound } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge, Input } from '@/components/ui/primitives';
import { NumericKeypad } from '@/components/ui/keypad';
import { paymentSummary, validatePayments } from '@/lib/pricing';
import { publicQrUrl } from '@/lib/supabase';
import { cn, formatMoney, parseDecimal, round } from '@/lib/utils';
import type { BusinessSettings, PaymentDraft, PaymentMethod } from '@/types';
import { METHOD_LABEL } from './checkout';

const METHODS: Array<{ id: PaymentMethod; icon: typeof Banknote; tone: string }> = [
  { id: 'efectivo', icon: Banknote, tone: 'bg-emerald-600' },
  { id: 'yape', icon: Smartphone, tone: 'bg-[#742384]' },
  { id: 'plin', icon: QrCode, tone: 'bg-[#00B2A9]' },
  { id: 'tarjeta', icon: CreditCard, tone: 'bg-sky-600' },
  { id: 'credito', icon: HandCoins, tone: 'bg-bone-dark' },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  settings: BusinessSettings;
  customer: { full_name: string; credit_enabled: boolean; credit_limit: number; balance: number; oldest_due_date: string | null } | null;
  onPickCustomer: () => void;
  onConfirm: (payments: PaymentDraft[]) => Promise<void>;
}

/**
 * Cobro con pagos mixtos: Efectivo + Yape/Plin (QR dinámico desde Supabase Storage) + Tarjeta + Fiado.
 */
export function PaymentDialog({ open, onOpenChange, total, settings, customer, onPickCustomer, onConfirm }: Props) {
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [active, setActive] = useState<PaymentMethod>('efectivo');
  const [amountInput, setAmountInput] = useState('');
  const [operation, setOperation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setActive('efectivo');
    setAmountInput('');
    setOperation('');
    setError(null);
  }, [open]);

  const summary = paymentSummary(total, payments);
  const remaining = summary.remaining;
  const entered = amountInput ? parseDecimal(amountInput) : remaining;

  const qrUrl = useMemo(() => {
    if (active === 'yape') return publicQrUrl(settings.yape_qr_path, settings.updated_at);
    if (active === 'plin') return publicQrUrl(settings.plin_qr_path, settings.updated_at);
    return null;
  }, [active, settings]);

  const creditAvailable = customer ? round(customer.credit_limit - customer.balance, 2) : 0;
  const creditBlocked =
    active === 'credito' &&
    (!customer ? 'Seleccione un cliente para fiar' : !customer.credit_enabled ? 'Cliente sin crédito habilitado' : entered > creditAvailable ? `Crédito disponible: ${formatMoney(creditAvailable, settings.currency_symbol)}` : null);

  const addPayment = () => {
    setError(null);
    if (remaining <= 0) return;
    if (entered <= 0) return setError('Monto inválido');
    if (creditBlocked) return setError(creditBlocked);
    if ((active === 'yape' || active === 'plin') && operation.trim().length < 4) {
      return setError(`Ingrese el N° de operación de ${METHOD_LABEL[active]}`);
    }
    const draft: PaymentDraft =
      active === 'efectivo'
        ? { method: 'efectivo', amount: round(Math.min(entered, remaining), 2), tendered: round(entered, 2) }
        : { method: active, amount: round(Math.min(entered, remaining), 2), operation_number: operation.trim() || undefined };
    if (active !== 'efectivo' && entered > remaining) return setError('Los pagos electrónicos no pueden exceder el saldo.');
    setPayments((p) => [...p, draft]);
    setAmountInput('');
    setOperation('');
  };

  const finish = async () => {
    const err = validatePayments(total, payments, !!customer);
    if (err) return setError(err);
    setBusy(true);
    try {
      await onConfirm(payments);
    } finally {
      setBusy(false);
    }
  };

  const symbol = settings.currency_symbol;
  const quickBills = [10, 20, 50, 100, 200].filter((b) => b >= remaining).slice(0, 3);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={`Cobrar ${formatMoney(total, symbol)}`}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Volver
          </Button>
          <Button variant="meat" size="lg" disabled={!summary.complete || busy} onClick={() => void finish()} className="min-w-48">
            {busy ? <Loader2 className="animate-spin" /> : null}
            Confirmar venta
            {summary.change > 0 && ` · Vuelto ${formatMoney(summary.change, symbol)}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* Izquierda: métodos y captura */}
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActive(m.id);
                  setError(null);
                }}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] font-bold transition active:scale-95',
                  active === m.id ? `${m.tone} border-transparent text-white shadow-lg` : 'hover:bg-muted',
                )}
              >
                <m.icon className="size-6" />
                {m.id === 'credito' ? 'Fiado' : METHOD_LABEL[m.id]}
              </button>
            ))}
          </div>

          {(active === 'yape' || active === 'plin') && (
            <motion.div key={active} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex gap-3 rounded-xl border p-3">
              <div className="grid size-40 shrink-0 place-items-center overflow-hidden rounded-lg bg-white">
                {qrUrl ? (
                  <img src={qrUrl} alt={`QR ${METHOD_LABEL[active]}`} className="size-full object-contain" />
                ) : (
                  <p className="p-3 text-center text-xs text-slate-500">Suba el QR en Ajustes &gt; Pagos</p>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                <p className="font-bold">{METHOD_LABEL[active]}</p>
                <p className="text-muted-foreground">
                  {active === 'yape' ? settings.yape_holder : settings.plin_holder}
                  <br />
                  {active === 'yape' ? settings.yape_phone : settings.plin_phone}
                </p>
                <p className="scale-digits text-2xl">{formatMoney(Math.min(entered, remaining), symbol)}</p>
                <Input
                  inputMode="numeric"
                  placeholder="N° de operación"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  className="mt-auto font-mono text-lg"
                />
              </div>
            </motion.div>
          )}

          {active === 'credito' && (
            <div className="rounded-xl border p-3 text-sm">
              {customer ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 font-bold">
                    <UserRound className="size-4" /> {customer.full_name}
                  </p>
                  <p>Deuda actual: {formatMoney(customer.balance, symbol)} · Límite {formatMoney(customer.credit_limit, symbol)}</p>
                  <p className="font-semibold">Disponible: {formatMoney(creditAvailable, symbol)}</p>
                  {customer.oldest_due_date && new Date(customer.oldest_due_date) < new Date() && (
                    <Badge tone="danger">Saldo vencido desde {customer.oldest_due_date} — requiere admin</Badge>
                  )}
                </div>
              ) : (
                <Button variant="outline" onClick={onPickCustomer} className="w-full">
                  <UserRound /> Seleccionar cliente
                </Button>
              )}
            </div>
          )}

          <div className="rounded-lg border p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {active === 'efectivo' ? 'Efectivo recibido' : 'Monto'}
              </span>
              <span className="text-xs text-muted-foreground">Pendiente {formatMoney(remaining, symbol)}</span>
            </div>
            <p className="scale-digits text-4xl">{amountInput || remaining.toFixed(2)}</p>
          </div>

          {active === 'efectivo' && remaining > 0 && quickBills.length > 0 && (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setAmountInput(remaining.toFixed(2))}>
                Exacto
              </Button>
              {quickBills.map((b) => (
                <Button key={b} variant="secondary" className="flex-1" onClick={() => setAmountInput(String(b))}>
                  {symbol}{b}
                </Button>
              ))}
            </div>
          )}

          <NumericKeypad value={amountInput} onChange={setAmountInput} decimals={2} />
          {error && <p className="rounded-md bg-meat/10 p-2 text-sm font-semibold text-meat">{error}</p>}
          <Button variant="burgundy" size="lg" className="w-full" onClick={addPayment} disabled={remaining <= 0}>
            Agregar pago {METHOD_LABEL[active]}
          </Button>
        </div>

        {/* Derecha: resumen de pagos */}
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
          <SummaryRow label="Total a cobrar" value={formatMoney(total, symbol)} big />
          <div className="flex-1 space-y-2">
            {payments.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Agregue uno o más pagos (venta mixta)</p>}
            {payments.map((p, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
                <div className="flex-1">
                  <p className="font-semibold">{METHOD_LABEL[p.method]}</p>
                  {p.operation_number && <p className="font-mono text-xs text-muted-foreground">Op. {p.operation_number}</p>}
                  {p.tendered !== undefined && p.tendered > p.amount && (
                    <p className="text-xs text-muted-foreground">Recibido {formatMoney(p.tendered, symbol)}</p>
                  )}
                </div>
                <p className="font-bold tabular-nums">{formatMoney(p.amount, symbol)}</p>
                <button onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-meat" aria-label="Quitar pago">
                  <Trash2 className="size-4" />
                </button>
              </motion.div>
            ))}
          </div>
          <div className="space-y-1 border-t pt-3">
            <SummaryRow label="Pagado" value={formatMoney(summary.paid, symbol)} />
            <SummaryRow label="Pendiente" value={formatMoney(remaining, symbol)} tone={remaining > 0 ? 'danger' : undefined} />
            {summary.change > 0 && <SummaryRow label="Vuelto" value={formatMoney(summary.change, symbol)} big tone="success" />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function SummaryRow({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div className={cn('flex items-baseline justify-between', big && 'text-xl font-extrabold', tone === 'danger' && 'text-meat', tone === 'success' && 'text-emerald-600 dark:text-emerald-400')}>
      <span className={cn(!big && 'text-sm text-muted-foreground')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
