import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PrinterConfig, ScaleConfig } from '@/types';

export const SCALE_PRESETS: Record<string, { label: string; config: Partial<ScaleConfig> }> = {
  cas: { label: 'CAS (PDS, ER, PR) — continuo', config: { protocol: 'continuous', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 } },
  systel: { label: 'Systel (Clipse, Croma) — continuo', config: { protocol: 'continuous', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 } },
  torrey: { label: 'Torrey (L-EQ, PC) — comando "P"', config: { protocol: 'request', baudRate: 9600, requestCommand: 'P', dataBits: 8, parity: 'none', stopBits: 1 } },
  toledo: { label: 'Toledo (Prix, 8217) — ENQ', config: { protocol: 'request', baudRate: 4800, requestCommand: '\\x05', dataBits: 7, parity: 'even', stopBits: 1 } },
  kretz: { label: 'Kretz (Report, Delta) — comando "W"', config: { protocol: 'request', baudRate: 9600, requestCommand: 'W\\r', dataBits: 8, parity: 'none', stopBits: 1 } },
};

export const DEFAULT_SCALE: ScaleConfig = {
  transport: 'serial',
  protocol: 'continuous',
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  requestCommand: 'P',
  pollIntervalMs: 300,
  stableReadings: 4,
  stableToleranceKg: 0.002,
  unitDivisor: 1,
};

interface DeviceState {
  terminalId: string;
  scalePreset: string;
  scale: ScaleConfig;
  printer: PrinterConfig;
  autoPrint: boolean;
  setTerminalId: (id: string) => void;
  setScale: (cfg: Partial<ScaleConfig>) => void;
  applyPreset: (key: string) => void;
  setPrinter: (cfg: Partial<PrinterConfig>) => void;
  setAutoPrint: (v: boolean) => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set) => ({
      terminalId: (import.meta.env.VITE_DEFAULT_TERMINAL_ID as string | undefined) ?? 'CAJA-1',
      scalePreset: 'cas',
      scale: DEFAULT_SCALE,
      printer: { paperWidthChars: 32, openCashDrawer: true, copies: 1 },
      autoPrint: true,
      setTerminalId: (terminalId) => set({ terminalId }),
      setScale: (cfg) => set((s) => ({ scale: { ...s.scale, ...cfg } })),
      applyPreset: (key) =>
        set((s) => ({ scalePreset: key, scale: { ...s.scale, ...(SCALE_PRESETS[key]?.config ?? {}) } })),
      setPrinter: (cfg) => set((s) => ({ printer: { ...s.printer, ...cfg } })),
      setAutoPrint: (autoPrint) => set({ autoPrint }),
    }),
    { name: 'carni-devices' },
  ),
);
