import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';

/**
 * Escáner de código de barras / QR con la cámara (móvil de operarios).
 * Decodificación con ZXing (EAN-13, Code128, QR, etc.).
 */
export function CameraScanner({
  open,
  onOpenChange,
  onResult,
  title = 'Escanear código',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResult: (text: string) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!open) return;
    let controls: IScannerControls | null = null;
    let cancelled = false;
    setError(null);
    setStarting(true);

    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
    // El <video> se monta dentro del portal del diálogo: esperar un frame
    const id = requestAnimationFrame(async () => {
      if (!videoRef.current) return;
      try {
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
          videoRef.current,
          (result, _err, ctrl) => {
            if (result && !cancelled) {
              cancelled = true;
              ctrl.stop();
              navigator.vibrate?.(60);
              onResult(result.getText());
              onOpenChange(false);
            }
          },
        );
        setStarting(false);
      } catch (e) {
        setError((e as Error).message.includes('Permission') ? 'Permiso de cámara denegado.' : 'No se pudo abrir la cámara.');
        setStarting(false);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      controls?.stop();
    };
  }, [open, onOpenChange, onResult]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description="Apunte al código de barras o QR del lote/producto">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-bone/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        {starting && !error && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div className="space-y-2">
              <Camera className="mx-auto size-10 opacity-60" />
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
