import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Select } from '@/components/ui/primitives';
import { queryKeys, useCustomers } from '@/hooks/useCatalog';
import { friendlyError, supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/utils';
import type { Customer } from '@/types';

export function CustomerPicker({
  open,
  onOpenChange,
  onPick,
  symbol,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (c: Customer | null) => void;
  symbol: string;
}) {
  const { data: customers = [] } = useCustomers(open);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ full_name: '', doc_type: 'DNI' as Customer['doc_type'], doc_number: '', phone: '' });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return customers.slice(0, 50);
    return customers.filter((c) => c.full_name.toLowerCase().includes(term) || c.doc_number?.includes(term) || c.phone?.includes(term)).slice(0, 50);
  }, [customers, q]);

  const create = async () => {
    if (!form.full_name.trim()) return toast.error('Ingrese el nombre');
    const { data, error } = await supabase
      .from('customers')
      .insert({ full_name: form.full_name.trim(), doc_type: form.doc_type, doc_number: form.doc_number || null, phone: form.phone || null })
      .select()
      .single();
    if (error) return toast.error(friendlyError(error));
    await qc.invalidateQueries({ queryKey: queryKeys.customers });
    toast.success('Cliente creado');
    onPick(data as Customer);
    onOpenChange(false);
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Cliente" description="Busque por nombre, DNI/RUC o teléfono">
      {!creating ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 size-5 text-muted-foreground" />
            <Input autoFocus placeholder="Buscar…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { onPick(null); onOpenChange(false); }}>
              Cliente varios
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => { setCreating(true); setForm((f) => ({ ...f, full_name: q })); }}>
              <Plus /> Nuevo
            </Button>
          </div>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
            {filtered.map((c) => {
              const overdue = c.oldest_due_date && new Date(`${c.oldest_due_date}T23:59:59`) < new Date();
              return (
                <li key={c.id}>
                  <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted" onClick={() => { onPick(c); onOpenChange(false); }}>
                    <UserRound className="size-5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.doc_type} {c.doc_number ?? '—'} · {c.phone ?? 'sin teléfono'}
                      </p>
                    </div>
                    {c.balance > 0 && <Badge tone={overdue ? 'danger' : 'warning'}>Debe {formatMoney(c.balance, symbol)}</Badge>}
                    {c.credit_enabled && c.balance <= 0 && <Badge tone="success">Crédito</Badge>}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Sin resultados</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Nombre / Razón social">
            <Input autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <Field label="Doc.">
              <Select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value as Customer['doc_type'] })}>
                <option>DNI</option>
                <option>RUC</option>
                <option>CE</option>
                <option>OTRO</option>
              </Select>
            </Field>
            <Field label="Número">
              <Input inputMode="numeric" value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} />
            </Field>
          </div>
          <Field label="Teléfono (WhatsApp)">
            <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">El límite de crédito lo habilita un administrador desde Clientes.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button variant="meat" className="flex-1" onClick={() => void create()}>
              Guardar
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
