import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Scale, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NumericKeypad } from '@/components/ui/keypad';
import { Badge, Select } from '@/components/ui/primitives';
import { ScaleDisplay } from '@/components/ScaleDisplay';
import { useScale } from '@/hooks/ScaleProvider';
import { useActiveLots, useCutTypes } from '@/hooks/useCatalog';
import { grossKgForNet, lineTotal } from '@/lib/pricing';
import { cn, daysUntil, formatKg, formatMoney, parseDecimal, round } from '@/lib/utils';
import type { CartLine, CutType, Product, WeightSource } from '@/types';

export interface WeightDialogResult {
  quantity: number;
  source: WeightSource;
  cut: CutType | null;
  lotId: string | null;
}

/**
 * Captura de peso: balanza en vivo, atajos o teclado manual.
 * Selección de corte/preparación (impacta merma) y lote (FIFO por defecto).
 */
export function WeightDialog({
  product,
  editing,
  open,
  onOpenChange,
  onConfirm,
  symbol,
}: {
  product: Product | null;
  editing?: CartLine | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (r: WeightDialogResult) => void;
  symbol: string;
}) {
  const scale = useScale();
  const { data: cutTypes = [] } = useCutTypes();
  const { data: lots = [] } = useActiveLots(product?.id);
  const [manual, setManual] = useState('');
  const [source, setSource] = useState<WeightSource>('manual');
  const [cutId, setCutId] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setManual(editing ? String(editing.quantity) : '');
    setSource(editing?.weight_source ?? 'manual');
    setCutId(editing?.cut_type_id ?? null);
    setLotId(editing?.lot_id ?? null);
  }, [open, editing]);

  const isWeight = product?.sell_by_weight ?? true;
  const scaleLive = scale.status === 'connected' && isWeight && manual === '' && !editing;
  const qty = scaleLive ? (scale.reading?.weightKg ?? 0) : parseDecimal(manual);
  const cut = cutTypes.find((c) => c.id === cutId) ?? null;

  const preview = useMemo(() => {
    if (!product) return null;
    const line = { quantity: qty, unit_price: product.price_per_unit, surcharge_per_kg: cut?.surcharge_per_kg ?? 0 };
    const gross = grossKgForNet(qty, cut?.shrink_pct ?? 0);
    return { total: lineTotal(line), gross, shrink: round(gross - qty, 3) };
  }, [product, qty, cut]);

  if (!product) return null;

  const stockAfter = product.stock_actual_kg - (preview?.gross ?? 0) + (editing ? grossKgForNet(editing.quantity, editing.shrink_pct) : 0);
  const fifoLot = lots[0];

  const confirm = async (fromScale: boolean) => {
    let finalQty = qty;
    let finalSource: WeightSource = source;
    if (fromScale) {
      try {
        setWaiting(true);
        const r = await scale.waitForStable();
        finalQty = r.weightKg;
        finalSource = 'scale';
      } catch (e) {
        toast.warning((e as Error).message);
        return;
      } finally {
        setWaiting(false);
      }
    }
    if (finalQty <= 0) {
      toast.error(isWeight ? 'Ingrese un peso mayor a 0' : 'Ingrese una cantidad');
      return;
    }
    onConfirm({ quantity: finalQty, source: finalSource, cut, lotId });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product.name}
      description={`${formatMoney(product.price_per_unit, symbol)} / ${product.unit} · Stock ${formatKg(product.stock_actual_kg, product.unit)}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {scaleLive && (
            <Button variant="bone" size="lg" onClick={() => void confirm(true)} disabled={waiting}>
              <Scale /> {waiting ? 'Estabilizando…' : 'Tomar peso estable'}
            </Button>
          )}
          {!scaleLive && (
            <Button variant="meat" size="lg" onClick={() => void confirm(false)}>
              <Check /> {editing ? 'Actualizar' : 'Agregar'} · {formatMoney(preview?.total ?? 0, symbol)}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {isWeight && <ScaleDisplay pricePerKg={product.price_per_unit} symbol={symbol} compact />}

          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{scaleLive ? 'O ingrese manualmente' : isWeight ? 'Peso (kg)' : 'Cantidad'}</p>
            <p className="scale-digits mt-1 text-4xl">{manual || (scaleLive ? '—' : '0')}</p>
          </div>

          {isWeight && product.weight_shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {product.weight_shortcuts.map((kg) => (
                <Button
                  key={kg}
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setManual(String(kg));
                    setSource('shortcut');
                  }}
                >
                  {kg < 1 ? `${kg * 1000} g` : `${kg} kg`}
                </Button>
              ))}
            </div>
          )}
          <NumericKeypad
            value={manual}
            decimals={isWeight ? 3 : 0}
            onChange={(v) => {
              setManual(v);
              setSource('manual');
            }}
          />
        </div>

        <div className="space-y-4">
          {isWeight && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Scissors className="size-4" /> Corte / preparación
              </p>
              <div className="grid grid-cols-2 gap-2">
                <CutChip active={cutId === null} onClick={() => setCutId(null)} name="Sin preparación" />
                {cutTypes.map((c) => (
                  <CutChip key={c.id} active={cutId === c.id} onClick={() => setCutId(c.id)} name={c.name} shrink={c.shrink_pct} surcharge={c.surcharge_per_kg} symbol={symbol} />
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-semibold">Lote (trazabilidad)</p>
            <Select value={lotId ?? ''} onChange={(e) => setLotId(e.target.value || null)}>
              <option value="">
                FIFO automático{fifoLot ? ` → ${fifoLot.lot_number}` : ' (sin lotes)'}
              </option>
              {lots.map((l) => {
                const d = daysUntil(l.expiry_date);
                return (
                  <option key={l.id} value={l.id}>
                    {l.lot_number} · {formatKg(l.remaining_kg)} · {d === null ? 's/v' : d < 0 ? 'VENCIDO' : `vence en ${d}d`}
                  </option>
                );
              })}
            </Select>
          </div>

          {preview && (
            <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
              <Row label="Neto a entregar" value={formatKg(qty, product.unit)} />
              {preview.shrink > 0 && <Row label={`Merma de preparación (${cut?.shrink_pct}%)`} value={`+${formatKg(preview.shrink)}`} tone="warning" />}
              {preview.shrink > 0 && <Row label="Sale de inventario" value={formatKg(preview.gross)} />}
              {cut && cut.surcharge_per_kg > 0 && <Row label="Recargo preparación" value={formatMoney(cut.surcharge_per_kg * qty, symbol)} />}
              <div className="border-t pt-1.5">
                <Row label="Total línea" value={formatMoney(preview.total, symbol)} strong />
              </div>
              {stockAfter < 0 && (
                <p className="flex items-center gap-1.5 pt-1 text-xs font-semibold text-meat">
                  <AlertTriangle className="size-4" /> Stock insuficiente ({formatKg(product.stock_actual_kg, product.unit)} disponibles)
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function CutChip({ active, onClick, name, shrink, surcharge, symbol }: { active: boolean; onClick: () => void; name: string; shrink?: number; surcharge?: number; symbol?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-touch flex-col items-start justify-center rounded-lg border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.97]',
        active ? 'border-meat bg-meat/10 text-meat ring-1 ring-meat' : 'hover:bg-muted',
      )}
    >
      {name}
      {(shrink || surcharge) ? (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {shrink ? <Badge tone="warning">merma {shrink}%</Badge> : null}
          {surcharge ? <Badge tone="info">+{symbol}{surcharge}/kg</Badge> : null}
        </span>
      ) : null}
    </button>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: 'warning'; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', tone === 'warning' && 'text-bone-dark dark:text-bone', strong && 'text-base font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
