import { cn } from '@/lib/utils';

/** Teclado numérico táctil para ingresar peso/montos sin teclado físico. */
export function NumericKeypad({
  value,
  onChange,
  decimals = 3,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  decimals?: number;
  className?: string;
}) {
  const press = (k: string) => {
    if (k === 'C') return onChange('');
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === '.') {
      if (decimals === 0 || value.includes('.')) return;
      return onChange(value === '' ? '0.' : `${value}.`);
    }
    const [, dec] = value.split('.');
    if (dec !== undefined && dec.length >= decimals) return;
    if (value === '0') return onChange(k);
    onChange(value + k);
  };

  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className="h-14 rounded-lg bg-muted text-2xl font-bold tabular-nums transition active:scale-95 active:bg-primary active:text-primary-foreground"
        >
          {k}
        </button>
      ))}
      <button
        type="button"
        onClick={() => press('C')}
        className="col-span-3 h-12 rounded-lg border text-sm font-semibold text-muted-foreground active:scale-[0.98]"
      >
        Limpiar
      </button>
    </div>
  );
}
