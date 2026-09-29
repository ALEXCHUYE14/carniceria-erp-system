import { motion } from 'framer-motion';
import { Plug, PlugZap, Scale } from 'lucide-react';
import { useScale } from '@/hooks/ScaleProvider';
import { Button } from '@/components/ui/button';
import { cn, formatMoney } from '@/lib/utils';

/** Visor de balanza estilo display LED para pantallas industriales. */
export function ScaleDisplay({
  pricePerKg,
  symbol = 'S/',
  compact = false,
  className,
}: {
  pricePerKg?: number;
  symbol?: string;
  compact?: boolean;
  className?: string;
}) {
  const scale = useScale();
  const w = scale.reading?.weightKg ?? 0;
  const stable = scale.reading?.stable ?? false;
  const connected = scale.status === 'connected';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#070b14] to-[#111827] p-3 text-white shadow-inner',
        className,
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-white/50">
        <span className="flex items-center gap-1">
          <Scale className="size-3.5" /> Balanza
        </span>
        <span className="flex items-center gap-1.5">
          <motion.span
            className={cn('inline-block size-2.5 rounded-full', !connected ? 'bg-white/30' : stable ? 'bg-emerald-400' : 'bg-bone')}
            animate={connected && !stable ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
            transition={{ repeat: Infinity, duration: 0.8 }}
          />
          {!connected ? 'Desconectada' : stable ? 'Estable' : 'Pesando…'}
        </span>
      </div>

      <div className="mt-1 flex items-end justify-between gap-3">
        <p className={cn('scale-digits leading-none', compact ? 'text-4xl' : 'text-5xl lg:text-6xl', stable ? 'text-emerald-300' : 'text-bone')}>
          {connected ? w.toFixed(3) : '--.---'}
          <span className="ml-1 text-lg text-white/50">kg</span>
        </p>
        {pricePerKg !== undefined && connected && w > 0 && (
          <p className="scale-digits text-xl text-white/80">{formatMoney(w * pricePerKg, symbol)}</p>
        )}
      </div>

      {!connected && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="bone" onClick={() => void scale.connect()} disabled={!scale.supported}>
            <Plug /> Conectar
          </Button>
          <span className="text-xs text-white/50">
            {scale.supported ? scale.error ?? 'USB/RS-232 o Bluetooth' : 'Navegador sin Web Serial/Bluetooth: use ingreso manual'}
          </span>
        </div>
      )}
      {connected && !compact && (
        <button onClick={() => void scale.disconnect()} className="absolute right-2 top-7 rounded p-1 text-white/30 hover:text-white/70" title="Desconectar">
          <PlugZap className="size-4" />
        </button>
      )}
    </div>
  );
}
