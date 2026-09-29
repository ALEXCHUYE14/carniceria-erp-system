import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, HandCoins, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { NumericKeypad } from '@/components/ui/keypad';
import { queryKeys, useCustomers, useSettings } from '@/hooks/useCatalog';
import { useAuthStore } from '@/stores/authStore';
import { enqueueCustomerPayment, syncOutbox } from '@/lib/offline/sync';
import { friendlyError, isNetworkError, supabase } from '@/lib/supabase';
import { cn, daysUntil, formatDate, formatMoney, parseDecimal, uuid } from '@/lib/utils';
import { whatsappLink } from '@/features/pos/checkout';
import type { Customer, LedgerEntry } from '@/types';
import { CustomerPicker } from './CustomerPicker';

type Filter = 'todos' | 'deudores' | 'vencidos';

/** Libreta digital de clientes: fiados, abonos, límites de crédito y cobranza por WhatsApp. */
export function CustomersPage() {
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? 'S/';
  const { data: customers = [], isLoading } = useCustomers();
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('deudores');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);

  const isOverdue = (c: Customer) => c.balance > 0 && (daysUntil(c.oldest_due_date) ?? 1) < 0;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return customers
      .filter((c) => filter === 'todos' || (filter === 'deudores' && c.balance > 0) || (filter === 'vencidos' && isOverdue(c)))
      .filter((c) => !term || c.full_name.toLowerCase().includes(term) || c.doc_number?.includes(term) || c.phone?.includes(term))
      .sort((a, b) => b.balance - a.balance);
  }, [customers, q, filter]);

  const totalDebt = customers.reduce((a, c) => a + Math.max(c.balance, 0), 0);
  const overdue = customers.filter(isOverdue);

  const reminders = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('enqueue_overdue_reminders');
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => toast.success(`${n} recordatorios encolados para WhatsApp`),
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cartera por cobrar" value={formatMoney(totalDebt, symbol)} />
        <Stat label="Clientes con deuda" value={customers.filter((c) => c.balance > 0).length} />
        <Stat label="Con saldo vencido" value={overdue.length} tone={overdue.length ? 'danger' : undefined} hint={formatMoney(overdue.reduce((a, c) => a + c.balance, 0), symbol)} />
        <Stat label="Con crédito habilitado" value={customers.filter((c) => c.credit_enabled).length} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-3.5 size-5 text-muted-foreground" />
          <Input placeholder="Nombre, DNI/RUC, teléfono…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-40">
          <option value="deudores">Con deuda</option>
          <option value="vencidos">Vencidos</option>
          <option value="todos">Todos</option>
        </Select>
        {isAdmin && (
          <Button variant="secondary" onClick={() => reminders.mutate()} disabled={reminders.isPending}>
            <BellRing /> Recordatorios
          </Button>
        )}
        <Button variant="meat" onClick={() => setCreating(true)}>
          <Plus /> Cliente
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users />} title="Sin clientes para este filtro" />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const od = isOverdue(c);
            const usage = c.credit_limit > 0 ? Math.min((c.balance / c.credit_limit) * 100, 100) : 0;
            return (
              <Card key={c.id} className={cn('cursor-pointer p-4 transition hover:shadow-md', od && 'border-meat/50')} onClick={() => setSelected(c)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{c.full_name}</p>
                    <p className="text-xs text-muted-foreground">{c.doc_type} {c.doc_number ?? '—'} · {c.phone ?? 'sin teléfono'}</p>
                  </div>
                  {od ? <Badge tone="danger"><AlertTriangle className="size-3" /> Vencido</Badge> : c.credit_enabled ? <Badge tone="success">Crédito</Badge> : null}
                </div>
                <p className={cn('mt-2 text-2xl font-extrabold tabular-nums', c.balance > 0 ? 'text-meat' : c.balance < 0 ? 'text-emerald-600' : '')}>
                  {c.balance < 0 ? `A favor ${formatMoney(-c.balance, symbol)}` : formatMoney(c.balance, symbol)}
                </p>
                {c.credit_enabled && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full', usage > 90 ? 'bg-meat' : usage > 70 ? 'bg-bone' : 'bg-emerald-500')} style={{ width: `${usage}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Límite {formatMoney(c.credit_limit, symbol)} · {c.credit_days} días
                      {c.oldest_due_date && ` · vence ${formatDate(c.oldest_due_date)}`}
                    </p>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CustomerDetail customer={selected} onClose={() => setSelected(null)} symbol={symbol} tradeName={settings?.trade_name ?? ''} isAdmin={isAdmin} />
      <CustomerPicker open={creating} onOpenChange={setCreating} onPick={(c) => c && setSelected(c)} symbol={symbol} />
    </div>
  );
}

function CustomerDetail({ customer, onClose, symbol, tradeName, isAdmin }: { customer: Customer | null; onClose: () => void; symbol: string; tradeName: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);

  const { data: ledger = [] } = useQuery({
    queryKey: ['ledger', customer?.id],
    enabled: !!customer,
    queryFn: async () => {
      const { data, error } = await supabase.from('customer_ledger').select('*').eq('customer_id', customer!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as LedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
    },
  });

  if (!customer) return null;
  const reminderText = `Hola ${customer.full_name}, le saluda ${tradeName}. Su saldo pendiente es ${formatMoney(customer.balance, symbol)}${customer.oldest_due_date ? ` (vencimiento ${formatDate(customer.oldest_due_date)})` : ''}. ¡Gracias por su preferencia!`;

  return (
    <>
      <Dialog
        open={!!customer}
        onOpenChange={(v) => !v && onClose()}
        title={customer.full_name}
        description={`${customer.doc_type} ${customer.doc_number ?? '—'} · ${customer.phone ?? 'sin teléfono'}`}
        size="lg"
        footer={
          <>
            {isAdmin && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Crédito
              </Button>
            )}
            {customer.phone && customer.balance > 0 && (
              <Button variant="outline" onClick={() => window.open(whatsappLink(customer.phone, reminderText), '_blank', 'noopener')}>
                <MessageCircle /> Recordar
              </Button>
            )}
            <Button variant="meat" disabled={customer.balance <= 0} onClick={() => setPaying(true)}>
              <HandCoins /> Registrar abono
            </Button>
          </>
        }
      >
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className="text-xl font-extrabold text-meat">{formatMoney(customer.balance, symbol)}</p>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">Límite</p>
            <p className="text-xl font-bold">{customer.credit_enabled ? formatMoney(customer.credit_limit, symbol) : '—'}</p>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">Disponible</p>
            <p className="text-xl font-bold">{customer.credit_enabled ? formatMoney(Math.max(customer.credit_limit - customer.balance, 0), symbol) : '—'}</p>
          </div>
        </div>
        <p className="mb-2 text-sm font-semibold">Movimientos</p>
        <ul className="divide-y rounded-lg border">
          {ledger.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Sin movimientos</li>}
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center gap-3 p-3 text-sm">
              <Badge tone={e.entry_type === 'cargo' ? 'danger' : e.entry_type === 'abono' ? 'success' : 'info'}>{e.entry_type}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate">{e.note ?? '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(e.created_at, true)}
                  {e.due_date && ` · vence ${formatDate(e.due_date)}`}
                </p>
              </div>
              <p className={cn('font-bold tabular-nums', e.entry_type === 'cargo' ? 'text-meat' : 'text-emerald-600 dark:text-emerald-400')}>
                {e.entry_type === 'cargo' ? '+' : '−'}
                {formatMoney(Math.abs(e.amount), symbol)}
              </p>
            </li>
          ))}
        </ul>
      </Dialog>

      <PaymentForm
        open={paying}
        onOpenChange={setPaying}
        customer={customer}
        symbol={symbol}
        tradeName={tradeName}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: queryKeys.customers });
          void qc.invalidateQueries({ queryKey: ['ledger', customer.id] });
          onClose();
        }}
      />
      {isAdmin && <CreditForm key={customer.id} open={editing} onOpenChange={setEditing} customer={customer} onDone={onClose} />}
    </>
  );
}

function PaymentForm({ open, onOpenChange, customer, symbol, tradeName, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; customer: Customer; symbol: string; tradeName: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'efectivo' | 'yape' | 'plin' | 'tarjeta'>('efectivo');
  const [op, setOp] = useState('');
  const [busy, setBusy] = useState(false);
  const value = parseDecimal(amount);

  const submit = async () => {
    if (value <= 0 || value > customer.balance) return toast.error('Monto inválido o mayor al saldo');
    if ((method === 'yape' || method === 'plin') && op.trim().length < 4) return toast.error('Ingrese el N° de operación');
    setBusy(true);
    const payload = { client_uuid: uuid(), customer_id: customer.id, amount: value, method, operation_number: op.trim() || null, note: null };
    try {
      const { data, error } = await supabase.rpc('register_customer_payment', {
        p_customer_id: customer.id, p_amount: value, p_method: method, p_operation_number: payload.operation_number, p_note: null,
      });
      if (error) throw error;
      const newBalance = Number((data as { new_balance: number }).new_balance);
      toast.success(`Abono registrado. Nuevo saldo ${formatMoney(newBalance, symbol)}`, {
        action: customer.phone
          ? {
              label: 'Enviar WhatsApp',
              onClick: () =>
                window.open(
                  whatsappLink(customer.phone, `${tradeName}: recibimos su abono de ${formatMoney(value, symbol)} (${method}). Saldo actual: ${formatMoney(newBalance, symbol)}. ¡Gracias!`),
                  '_blank',
                  'noopener',
                ),
            }
          : undefined,
        duration: 10_000,
      });
      onOpenChange(false);
      setAmount('');
      setOp('');
      onDone();
    } catch (e) {
      if (isNetworkError(e)) {
        await enqueueCustomerPayment(payload);
        void syncOutbox();
        toast.warning('Sin conexión: el abono se registrará al recuperar la señal');
        onOpenChange(false);
        onDone();
      } else toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar abono"
      description={`Saldo pendiente ${formatMoney(customer.balance, symbol)}`}
      size="sm"
      footer={<Button variant="meat" className="w-full" size="lg" disabled={busy} onClick={() => void submit()}>Confirmar abono {value > 0 && formatMoney(value, symbol)}</Button>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {(['efectivo', 'yape', 'plin', 'tarjeta'] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={cn('h-12 rounded-lg border text-xs font-bold capitalize', method === m && 'border-meat bg-meat text-white')}>
              {m}
            </button>
          ))}
        </div>
        <p className="scale-digits rounded-lg border p-3 text-right text-4xl">{amount || '0.00'}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setAmount(customer.balance.toFixed(2))}>Total</Button>
          <Button variant="secondary" className="flex-1" onClick={() => setAmount((customer.balance / 2).toFixed(2))}>50%</Button>
        </div>
        {(method === 'yape' || method === 'plin') && (
          <Input placeholder="N° de operación" inputMode="numeric" value={op} onChange={(e) => setOp(e.target.value.replace(/\D/g, ''))} className="font-mono" />
        )}
        <NumericKeypad value={amount} onChange={setAmount} decimals={2} />
      </div>
    </Dialog>
  );
}

function CreditForm({ open, onOpenChange, customer, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; customer: Customer; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    full_name: customer.full_name,
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    credit_enabled: customer.credit_enabled,
    credit_limit: String(customer.credit_limit),
    credit_days: String(customer.credit_days),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customers')
        .update({
          full_name: f.full_name,
          phone: f.phone || null,
          address: f.address || null,
          credit_enabled: f.credit_enabled,
          credit_limit: parseDecimal(f.credit_limit),
          credit_days: Number(f.credit_days) || 0,
        })
        .eq('id', customer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Cliente actualizado');
      void qc.invalidateQueries({ queryKey: queryKeys.customers });
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Datos y crédito" footer={<Button variant="meat" onClick={() => save.mutate()} disabled={save.isPending}>Guardar</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Teléfono"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Dirección"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <label className="flex items-center gap-3 rounded-lg border p-3 sm:col-span-2">
          <input type="checkbox" className="size-5 accent-[#DC2626]" checked={f.credit_enabled} onChange={(e) => setF({ ...f, credit_enabled: e.target.checked })} />
          <span className="font-semibold">Habilitar venta al crédito (fiado)</span>
        </label>
        <Field label="Límite de crédito"><Input inputMode="decimal" value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value })} /></Field>
        <Field label="Plazo (días)"><Input inputMode="numeric" value={f.credit_days} onChange={(e) => setF({ ...f, credit_days: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
