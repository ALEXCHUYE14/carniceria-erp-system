import { lazy, Suspense, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Beef, Loader2, Lock, ScanLine, Search, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useCategories, useProducts, useSettings } from '@/hooks/useCatalog';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { ScaleDisplay } from '@/components/ScaleDisplay';
import { Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { CustomerPicker } from '@/features/customers/CustomerPicker';
import { computeTotals, validateDiscount } from '@/lib/pricing';
import { cn, formatKg, formatMoney } from '@/lib/utils';
import type { CartLine, PaymentDraft, Product } from '@/types';
import type { TicketData } from '@/lib/hardware/escpos';
import { WeightDialog, type WeightDialogResult } from './WeightDialog';
import { TicketPanel } from './TicketPanel';
import { PaymentDialog } from './PaymentDialog';
import { ReceiptDialog } from './ReceiptDialog';
import { performCheckout, printTicket } from './checkout';
import { useCurrentCashSession } from '@/features/cash/useCashSession';

const CameraScanner = lazy(() => import('@/components/CameraScanner').then((m) => ({ default: m.CameraScanner })));

/**
 * POS en 3 columnas (tablet/PC): Categorías · Productos con atajos de peso · Ticket activo.
 * En móvil: chips de categorías + grilla + ticket en hoja inferior.
 */
export function PosPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading: loadingSettings } = useSettings();
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const cart = useCartStore();
  const profile = useAuthStore((s) => s.profile);
  const { terminalId, printer, autoPrint } = useDeviceStore();
  const navigate = useNavigate();
  const { data: cash } = useCurrentCashSession(terminalId);
  // Solo se bloquea si el servidor confirmó que no hay turno; sin red se permite vender offline
  const cashClosed = !!cash?.verified && !cash.session;

  const [categoryId, setCategoryId] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [weighing, setWeighing] = useState<Product | null>(null);
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [paying, setPaying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mobileTicket, setMobileTicket] = useState(false);
  const [receipt, setReceipt] = useState<{ ticket: TicketData; offline: boolean; phone: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoryId === 'all' || p.category_id === categoryId) &&
        (!term || p.name.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term) || p.barcode === term),
    );
  }, [products, categoryId, search]);

  const openProduct = useCallback((p: Product) => {
    setEditingLine(null);
    setWeighing(p);
  }, []);

  // Lector de código de barras tipo "keyboard wedge" o escaneo por cámara
  const handleCode = useCallback(
    (code: string) => {
      const c = code.trim();
      const p = products.find((x) => x.barcode === c || x.sku === c);
      if (!p) {
        toast.error(`Código no encontrado: ${c}`);
        return;
      }
      setSearch('');
      if (p.sell_by_weight) openProduct(p);
      else cart.addProduct(p, 1, 'manual');
    },
    [products, openProduct, cart],
  );

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      const exact = products.find((x) => x.barcode === search.trim() || x.sku === search.trim());
      if (exact) handleCode(search);
      else if (filtered.length === 1 && filtered[0]) openProduct(filtered[0]);
    }
  };

  const onWeightConfirm = (r: WeightDialogResult) => {
    if (editingLine) {
      cart.updateQuantity(editingLine.key, r.quantity, r.source);
      cart.setCut(editingLine.key, r.cut);
      cart.setLot(editingLine.key, r.lotId);
      setEditingLine(null);
    } else if (weighing) {
      cart.addProduct(weighing, r.quantity, r.source, r.cut, r.lotId);
      navigator.vibrate?.(30);
    }
    searchRef.current?.focus();
  };

  const confirmSale = async (payments: PaymentDraft[]) => {
    if (!settings || !profile) return;
    const customer = cart.customer;
    const outcome = await performCheckout(
      { lines: cart.lines, payments, discount: cart.discount, customer, terminalId, settings },
      profile.full_name,
      qc,
    );
    if (outcome.error) {
      toast.error(outcome.error, { duration: 8000 });
      return;
    }
    setPaying(false);
    setMobileTicket(false);
    cart.clear();
    setReceipt({ ticket: outcome.ticket, offline: outcome.offline, phone: customer?.phone ?? null });
    if (autoPrint) {
      printTicket(outcome.ticket, printer).catch(() => {
        /* sin impresora vinculada: se puede reimprimir desde el diálogo */
      });
    }
  };

  if (loadingSettings || !settings) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="size-8 animate-spin text-meat" />
      </div>
    );
  }

  const symbol = settings.currency_symbol;
  const totals = computeTotals(cart.lines, cart.discount, settings.tax_rate, settings.prices_include_tax);
  const startCharge = () => {
    if (cashClosed) {
      toast.error('La caja está cerrada. Abre el turno antes de cobrar.', {
        action: { label: 'Abrir caja', onClick: () => navigate('/arqueo') },
      });
      return;
    }
    const discountError = validateDiscount(totals.gross, cart.discount, settings.max_discount_pct, profile?.role === 'admin');
    if (discountError) {
      toast.error(discountError, { duration: 8000 });
      return;
    }
    setPaying(true);
  };
  const editingProduct = editingLine ? (products.find((p) => p.id === editingLine.product_id) ?? null) : null;

  return (
    <div className="flex h-full min-h-0">
      {/* Col 1: Categorías (tablet/PC) */}
      <aside className="scrollbar-thin hidden w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3 lg:flex xl:w-52">
        <CategoryButton active={categoryId === 'all'} onClick={() => setCategoryId('all')} name="Todo" />
        {categories.map((c) => (
          <CategoryButton key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)} name={c.name} image={c.image_url} />
        ))}
      </aside>

      {/* Col 2: Productos */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b p-3">
          {cashClosed && (
            <button
              onClick={() => navigate('/arqueo')}
              className="flex w-full items-center gap-2 rounded-lg bg-bone/20 px-3 py-2 text-left text-sm font-semibold text-bone-dark dark:text-bone"
            >
              <Lock className="size-4 shrink-0" />
              Caja {terminalId} cerrada: abre el turno para poder cobrar →
            </button>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3.5 size-5 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                placeholder="Buscar producto o escanear código…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKey}
                className="pl-10"
              />
            </div>
            <Button variant="secondary" size="icon" onClick={() => setScanning(true)} aria-label="Escanear con cámara">
              <ScanLine />
            </Button>
          </div>
          {/* Chips de categoría en móvil/tablet vertical */}
          <div className="scrollbar-thin -mx-3 flex gap-2 overflow-x-auto px-3 lg:hidden">
            {[{ id: 'all', name: 'Todo' }, ...categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  'h-10 shrink-0 rounded-full border px-4 text-sm font-semibold',
                  categoryId === c.id ? 'border-meat bg-meat text-white' : 'bg-card',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden p-3 pb-0 md:block">
          <ScaleDisplay symbol={symbol} compact />
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="grid place-items-center py-20">
              <Loader2 className="size-8 animate-spin text-meat" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} symbol={symbol} onOpen={() => openProduct(p)} onQuick={(kg) => cart.addProduct(p, kg, 'shortcut')} />
              ))}
              {filtered.length === 0 && <p className="col-span-full py-12 text-center text-muted-foreground">Sin productos</p>}
            </div>
          )}
        </div>
      </section>

      {/* Col 3: Ticket (tablet/PC) */}
      <TicketPanel
        settings={settings}
        className="hidden w-[340px] shrink-0 border-l md:flex xl:w-[380px]"
        onEditLine={(l) => {
          setEditingLine(l);
          setWeighing(null);
        }}
        onPickCustomer={() => setPickCustomer(true)}
        onCharge={startCharge}
      />

      {/* Botón flotante de ticket en móvil */}
      <AnimatePresence>
        {cart.lines.length > 0 && !mobileTicket && (
          <motion.button
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            onClick={() => setMobileTicket(true)}
            className="fixed bottom-20 left-3 right-3 z-30 flex h-14 items-center gap-3 rounded-2xl bg-meat px-4 font-bold text-white shadow-xl shadow-meat/30 md:hidden"
          >
            <ShoppingCart className="size-5" />
            <span>{cart.lines.length} ítems</span>
            <span className="ml-auto text-lg tabular-nums">{formatMoney(totals.total, symbol)}</span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mobileTicket && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => info.offset.y > 120 && setMobileTicket(false)}
            className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col rounded-t-2xl border-t bg-card shadow-2xl md:hidden"
          >
            <div className="mx-auto my-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            <TicketPanel
              settings={settings}
              className="min-h-0 flex-1"
              onEditLine={(l) => {
                setEditingLine(l);
                setWeighing(null);
              }}
              onPickCustomer={() => setPickCustomer(true)}
              onCharge={startCharge}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <WeightDialog
        product={editingLine ? editingProduct : weighing}
        editing={editingLine}
        open={!!weighing || !!editingLine}
        onOpenChange={(v) => {
          if (!v) {
            setWeighing(null);
            setEditingLine(null);
          }
        }}
        onConfirm={onWeightConfirm}
        symbol={symbol}
      />
      <CustomerPicker open={pickCustomer} onOpenChange={setPickCustomer} onPick={(c) => cart.setCustomer(c)} symbol={symbol} />
      <PaymentDialog
        open={paying}
        onOpenChange={setPaying}
        total={totals.total}
        settings={settings}
        customer={cart.customer}
        onPickCustomer={() => setPickCustomer(true)}
        onConfirm={confirmSale}
      />
      {scanning && (<Suspense fallback={null}><CameraScanner open={scanning} onOpenChange={setScanning} onResult={handleCode} /></Suspense>)}
      <ReceiptDialog
        ticket={receipt?.ticket ?? null}
        offline={receipt?.offline ?? false}
        customerPhone={receipt?.phone ?? null}
        symbol={symbol}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}

function CategoryButton({ active, onClick, name, image }: { active: boolean; onClick: () => void; name: string; image?: string | null }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex h-20 shrink-0 items-end overflow-hidden rounded-xl border p-3 text-left font-bold transition active:scale-[0.97]',
        active ? 'border-meat ring-2 ring-meat' : 'hover:border-muted-foreground/40',
      )}
    >
      {image ? (
        <img src={image} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-burgundy to-meat-dark" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="relative text-white drop-shadow">{name}</span>
    </button>
  );
}

function ProductCard({ product, symbol, onOpen, onQuick }: { product: Product; symbol: string; onOpen: () => void; onQuick: (kg: number) => void }) {
  const low = product.stock_actual_kg <= product.min_stock_kg;
  const out = product.stock_actual_kg <= 0;
  return (
    <motion.div whileTap={{ scale: 0.97 }} className={cn('flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm', out && 'opacity-60')}>
      <button onClick={onOpen} className="flex flex-1 flex-col text-left">
        <div className="relative h-20 w-full bg-gradient-to-br from-burgundy/90 to-meat/80 sm:h-24">
          {product.image_url ? (
            <img src={product.image_url} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <Beef className="absolute right-3 top-3 size-10 text-white/25" />
          )}
          {low && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-bone px-2 py-0.5 text-[10px] font-bold text-burgundy-950">
              <AlertTriangle className="size-3" /> {out ? 'Agotado' : 'Stock bajo'}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-2.5">
          <p className="line-clamp-2 text-sm font-semibold leading-tight">{product.name}</p>
          <p className="mt-auto whitespace-nowrap pt-1 text-sm font-extrabold text-meat sm:text-base">
            {formatMoney(product.price_per_unit, symbol)}
            <span className="text-xs font-medium text-muted-foreground">/{product.unit}</span>
          </p>
          <p className="text-[11px] tabular-nums text-muted-foreground">{formatKg(product.stock_actual_kg, product.unit)}</p>
        </div>
      </button>
      {product.sell_by_weight && product.weight_shortcuts.length > 0 && (
        <div className="grid border-t" style={{ gridTemplateColumns: `repeat(${Math.min(product.weight_shortcuts.length, 3)}, minmax(0,1fr))` }}>
          {product.weight_shortcuts.slice(0, 3).map((kg) => (
            <button key={kg} onClick={() => onQuick(kg)} className="h-11 border-r text-xs font-bold last:border-r-0 hover:bg-muted active:bg-meat active:text-white">
              {kg < 1 ? `${kg * 1000}g` : `${kg}kg`}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
