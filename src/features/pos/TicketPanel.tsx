import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, Receipt, ShoppingBasket, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { useCartStore } from '@/stores/cartStore';
import { computeTotals, lineTotal } from '@/lib/pricing';
import { cn, formatKg, formatMoney } from '@/lib/utils';
import type { BusinessSettings, CartLine } from '@/types';

/** Ticket activo con modificadores de corte, cliente, descuento y totales. */
export function TicketPanel({
  settings,
  onEditLine,
  onPickCustomer,
  onCharge,
  className,
}: {
  settings: BusinessSettings;
  onEditLine: (line: CartLine) => void;
  onPickCustomer: () => void;
  onCharge: () => void;
  className?: string;
}) {
  const { lines, customer, discount, removeLine, updateQuantity, setCustomer, setDiscount, clear, selectedLineKey } = useCartStore();
  const totals = computeTotals(lines, discount, settings.tax_rate, settings.prices_include_tax);
  const symbol = settings.currency_symbol;

  return (
    <div className={cn('flex min-h-0 flex-col bg-card', className)}>
      <div className="flex items-center gap-2 border-b p-3">
        <Receipt className="size-5 text-meat" />
        <p className="font-bold">Ticket</p>
        <Badge className="ml-1">{lines.length}</Badge>
        {lines.length > 0 && (
          <button onClick={clear} className="ml-auto rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-meat">
            Vaciar
          </button>
        )}
      </div>

      <button onClick={onPickCustomer} className="flex items-center gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted">
        <UserRound className="size-4 text-muted-foreground" />
        {customer ? (
          <>
            <span className="flex-1 truncate font-semibold">{customer.full_name}</span>
            {customer.balance > 0 && <Badge tone="warning">Debe {formatMoney(customer.balance, symbol)}</Badge>}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setCustomer(null);
              }}
              className="rounded p-1 hover:bg-background"
            >
              <X className="size-4" />
            </span>
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">Cliente varios · tocar para asignar</span>
        )}
      </button>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <ShoppingBasket className="size-12 opacity-40" />
            <p className="text-sm">Seleccione un producto o escanee un código</p>
          </div>
        ) : (
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.li
                  key={l.key}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn('group', selectedLineKey === l.key && 'bg-meat/5')}
                >
                  <div className="flex items-start gap-2 p-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => onEditLine(l)}>
                      <p className="truncate font-semibold">{l.product_name}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatKg(l.quantity, l.unit)} × {formatMoney(l.unit_price, symbol)}
                        {l.weight_source === 'scale' && ' · ⚖'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.cut_type_name && <Badge tone="warning">{l.cut_type_name}</Badge>}
                        {l.lot_id && <Badge tone="info">Lote fijo</Badge>}
                      </div>
                    </button>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tabular-nums">{formatMoney(lineTotal(l), symbol)}</p>
                      <div className="flex items-center gap-1">
                        {l.unit === 'und' && (
                          <>
                            <button className="grid size-9 place-items-center rounded-md border" onClick={() => updateQuantity(l.key, l.quantity - 1)} aria-label="Menos">
                              <Minus className="size-4" />
                            </button>
                            <button className="grid size-9 place-items-center rounded-md border" onClick={() => updateQuantity(l.key, l.quantity + 1)} aria-label="Más">
                              <Plus className="size-4" />
                            </button>
                          </>
                        )}
                        <button className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-meat/10 hover:text-meat" onClick={() => removeLine(l.key)} aria-label="Eliminar">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div className="space-y-1.5 border-t p-3 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Descuento</span>
          <input
            type="number"
            min={0}
            step="0.10"
            value={discount || ''}
            placeholder="0.00"
            onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            className="h-9 w-24 rounded-md border bg-background px-2 text-right tabular-nums"
          />
        </div>
        <Row label="Op. gravada" value={formatMoney(totals.subtotal, symbol)} />
        <Row label={`${settings.tax_name} ${settings.tax_rate}%`} value={formatMoney(totals.tax, symbol)} />
        <div className="flex items-baseline justify-between pt-1">
          <span className="text-lg font-bold">TOTAL</span>
          <span className="scale-digits text-3xl text-meat">{formatMoney(totals.total, symbol)}</span>
        </div>
        <Button variant="meat" size="xl" className="mt-2 w-full" disabled={lines.length === 0 || totals.total <= 0} onClick={onCharge}>
          Cobrar
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
