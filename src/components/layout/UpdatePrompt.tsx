import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

/** Aviso de nueva versión de la PWA. No recarga solo para no interrumpir una venta en curso. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border bg-card p-3 shadow-2xl md:bottom-4">
      <p className="flex-1 text-sm">Hay una nueva versión disponible.</p>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Luego
      </Button>
      <Button size="sm" variant="meat" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </Button>
    </div>
  );
}
