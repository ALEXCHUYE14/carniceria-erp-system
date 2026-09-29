import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useSerialScale, type UseSerialScale } from '@/hooks/useSerialScale';
import { useDeviceStore } from '@/stores/deviceStore';

const ScaleContext = createContext<UseSerialScale | null>(null);

/** Una única conexión a la balanza compartida por POS y despiece. */
export function ScaleProvider({ children }: { children: ReactNode }) {
  const config = useDeviceStore((s) => s.scale);
  const scale = useSerialScale(config);

  // Reconexión silenciosa a un puerto ya autorizado al abrir la app
  useEffect(() => {
    void scale.reconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <ScaleContext.Provider value={scale}>{children}</ScaleContext.Provider>;
}

export function useScale(): UseSerialScale {
  const ctx = useContext(ScaleContext);
  if (!ctx) throw new Error('useScale debe usarse dentro de <ScaleProvider>');
  return ctx;
}
