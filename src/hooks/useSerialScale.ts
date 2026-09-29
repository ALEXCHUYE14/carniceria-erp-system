// =====================================================================
// useSerialScale — lectura en tiempo real de balanzas por USB/RS-232 (Web Serial)
// o Bluetooth LE (perfil UART Nordic/HM-10, usado por adaptadores BT de balanzas).
//
// Modos:
//  - continuous: la balanza transmite tramas sin parar (CAS, Systel). Event-driven.
//  - request:    se envía un comando cada `pollIntervalMs` (Torrey "P", Toledo ENQ). Polling.
//
// Uso:
//   const scale = useSerialScale(config);
//   <button onClick={scale.connect}>Conectar</button>
//   scale.reading?.weightKg / scale.reading?.stable
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScaleConfig, ScaleReading, ScaleStatus } from '@/types';
import { decodeCommand, FrameBuffer, parseScaleFrame, StabilityDetector } from '@/lib/hardware/scaleParser';

// UUIDs de UART sobre BLE más comunes en adaptadores de balanza
const BLE_UART_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / CC2541
];
const BLE_NOTIFY_CHARS = ['6e400003-b5a3-f393-e0a9-e50e24dcca9e', '0000ffe1-0000-1000-8000-00805f9b34fb'];
const BLE_WRITE_CHARS = ['6e400002-b5a3-f393-e0a9-e50e24dcca9e', '0000ffe1-0000-1000-8000-00805f9b34fb'];

export const isWebSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;
export const isWebBluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export interface UseSerialScale {
  status: ScaleStatus;
  reading: ScaleReading | null;
  error: string | null;
  supported: boolean;
  /** Abre el selector del navegador (requiere gesto del usuario). */
  connect: () => Promise<void>;
  /** Reconecta sin diálogo a un puerto ya autorizado (al cargar la app). */
  reconnect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** Envía el comando de tara si la balanza lo soporta (ej. "T"). */
  sendCommand: (cmd: string) => Promise<void>;
  /** Espera la próxima lectura estable > 0 (útil para "pesar y agregar"). */
  waitForStable: (timeoutMs?: number) => Promise<ScaleReading>;
}

export function useSerialScale(config: ScaleConfig): UseSerialScale {
  const [status, setStatus] = useState<ScaleStatus>('disconnected');
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cfgRef = useRef(config);
  cfgRef.current = config;

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<((data: Uint8Array) => Promise<void>) | null>(null);
  const bleDeviceRef = useRef<BluetoothDevice | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keepReadingRef = useRef(false);
  const frameBuf = useRef(new FrameBuffer());
  const stability = useRef(new StabilityDetector(config.stableReadings, config.stableToleranceKg));
  const latestRef = useRef<ScaleReading | null>(null);
  const waitersRef = useRef<Array<{ resolve: (r: ScaleReading) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>([]);
  const lastEmitRef = useRef(0);

  const supported = config.transport === 'serial' ? isWebSerialSupported() : isWebBluetoothSupported();

  useEffect(() => {
    stability.current = new StabilityDetector(config.stableReadings, config.stableToleranceKg);
  }, [config.stableReadings, config.stableToleranceKg]);

  // ------------------------------------------------------------------
  // Procesamiento de datos entrantes (común a Serial y BLE)
  // ------------------------------------------------------------------
  const decoder = useRef(new TextDecoder('latin1'));

  const handleChunk = useCallback((chunk: Uint8Array) => {
    const text = decoder.current.decode(chunk, { stream: true });
    for (const frame of frameBuf.current.push(text)) {
      const parsed = parseScaleFrame(frame, cfgRef.current.unitDivisor);
      if (!parsed) continue;
      const windowStable = stability.current.push(parsed.weightKg);
      // Si la balanza informa ST/US lo respetamos; si no, usamos la ventana deslizante
      const stable = parsed.stableFlag ?? windowStable;
      const r: ScaleReading = { weightKg: parsed.weightKg, stable, raw: parsed.raw, at: Date.now() };
      latestRef.current = r;

      if (stable && r.weightKg > 0 && waitersRef.current.length) {
        for (const w of waitersRef.current) {
          clearTimeout(w.timer);
          w.resolve(r);
        }
        waitersRef.current = [];
      }

      // Limitar renders (~15 fps) en balanzas que transmiten a alta frecuencia
      const now = performance.now();
      if (now - lastEmitRef.current > 66 || stable) {
        lastEmitRef.current = now;
        setReading(r);
      }
    }
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const startPolling = useCallback(() => {
    stopPolling();
    if (cfgRef.current.protocol !== 'request') return;
    const cmd = decodeCommand(cfgRef.current.requestCommand);
    pollRef.current = setInterval(() => {
      void writerRef.current?.(cmd).catch(() => undefined);
    }, cfgRef.current.pollIntervalMs);
  }, []);

  const cleanupState = useCallback(() => {
    stopPolling();
    frameBuf.current.reset();
    stability.current.reset();
    latestRef.current = null;
    setReading(null);
    for (const w of waitersRef.current) {
      clearTimeout(w.timer);
      w.reject(new Error('Balanza desconectada'));
    }
    waitersRef.current = [];
  }, []);

  // ------------------------------------------------------------------
  // Web Serial
  // ------------------------------------------------------------------
  const readLoop = useCallback(async (port: SerialPort) => {
    keepReadingRef.current = true;
    while (port.readable && keepReadingRef.current) {
      const reader = port.readable.getReader();
      readerRef.current = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) handleChunk(value);
        }
      } catch (err) {
        // Errores recuperables (framing/parity/buffer overrun): reintentar el ciclo
        const name = (err as DOMException)?.name;
        if (name !== 'FramingError' && name !== 'ParityError' && name !== 'BufferOverrunError' && name !== 'BreakError') {
          setError((err as Error).message);
          setStatus('error');
          keepReadingRef.current = false;
        }
      } finally {
        reader.releaseLock();
        readerRef.current = null;
      }
    }
  }, [handleChunk]);

  const openSerial = useCallback(async (port: SerialPort) => {
    const c = cfgRef.current;
    setStatus('connecting');
    setError(null);
    try {
      await port.open({
        baudRate: c.baudRate,
        dataBits: c.dataBits,
        parity: c.parity,
        stopBits: c.stopBits,
        flowControl: 'none',
        bufferSize: 1024,
      });
    } catch (err) {
      // Si ya estaba abierto por esta misma pestaña, continuar
      if ((err as DOMException)?.name !== 'InvalidStateError') throw err;
    }
    portRef.current = port;
    writerRef.current = async (data: Uint8Array) => {
      if (!port.writable) return;
      const writer = port.writable.getWriter();
      try {
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
    };
    setStatus('connected');
    void readLoop(port);
    startPolling();
  }, [readLoop, startPolling]);

  // ------------------------------------------------------------------
  // Web Bluetooth (BLE UART)
  // ------------------------------------------------------------------
  const openBluetooth = useCallback(async (device: BluetoothDevice) => {
    setStatus('connecting');
    setError(null);
    const server = await device.gatt?.connect();
    if (!server) throw new Error('No se pudo conectar al GATT de la balanza');

    let notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
    let writeChar: BluetoothRemoteGATTCharacteristic | null = null;
    for (const svcUuid of BLE_UART_SERVICES) {
      try {
        const svc = await server.getPrimaryService(svcUuid);
        for (const c of BLE_NOTIFY_CHARS) {
          try { notifyChar = await svc.getCharacteristic(c); break; } catch { /* siguiente */ }
        }
        for (const c of BLE_WRITE_CHARS) {
          try { writeChar = await svc.getCharacteristic(c); break; } catch { /* siguiente */ }
        }
        if (notifyChar) break;
      } catch { /* servicio no presente */ }
    }
    if (!notifyChar) throw new Error('La balanza BLE no expone un servicio UART compatible');

    notifyChar.addEventListener('characteristicvaluechanged', (ev) => {
      const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (dv) handleChunk(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    });
    await notifyChar.startNotifications();

    const wc = writeChar;
    writerRef.current = wc
      ? async (data: Uint8Array) => {
          await wc.writeValueWithoutResponse(data);
        }
      : null;

    device.addEventListener('gattserverdisconnected', () => {
      setStatus('disconnected');
      cleanupState();
    });
    bleDeviceRef.current = device;
    setStatus('connected');
    startPolling();
  }, [handleChunk, startPolling, cleanupState]);

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------
  const connect = useCallback(async () => {
    try {
      if (cfgRef.current.transport === 'serial') {
        if (!isWebSerialSupported()) throw new Error('Web Serial no disponible. Use Chrome o Edge (escritorio).');
        const port = await navigator.serial.requestPort();
        await openSerial(port);
      } else {
        if (!isWebBluetoothSupported()) throw new Error('Web Bluetooth no disponible en este navegador.');
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: BLE_UART_SERVICES,
        });
        await openBluetooth(device);
      }
    } catch (err) {
      const e = err as DOMException;
      if (e?.name === 'NotFoundError') {
        setStatus('disconnected'); // el usuario cerró el diálogo
        return;
      }
      setError(e?.message ?? 'Error al conectar la balanza');
      setStatus('error');
    }
  }, [openSerial, openBluetooth]);

  const reconnect = useCallback(async () => {
    if (cfgRef.current.transport !== 'serial' || !isWebSerialSupported()) return false;
    const ports = await navigator.serial.getPorts();
    const port = ports[0];
    if (!port) return false;
    try {
      await openSerial(port);
      return true;
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      return false;
    }
  }, [openSerial]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    cleanupState();
    try {
      await readerRef.current?.cancel();
    } catch { /* ignorar */ }
    try {
      await portRef.current?.close();
    } catch { /* ignorar */ }
    portRef.current = null;
    if (bleDeviceRef.current?.gatt?.connected) bleDeviceRef.current.gatt.disconnect();
    bleDeviceRef.current = null;
    writerRef.current = null;
    setStatus('disconnected');
  }, [cleanupState]);

  const sendCommand = useCallback(async (cmd: string) => {
    if (!writerRef.current) throw new Error('La balanza no admite comandos o no está conectada');
    await writerRef.current(decodeCommand(cmd));
  }, []);

  const waitForStable = useCallback((timeoutMs = 8000) => {
    const cur = latestRef.current;
    if (cur?.stable && cur.weightKg > 0 && Date.now() - cur.at < 1000) return Promise.resolve(cur);
    return new Promise<ScaleReading>((resolve, reject) => {
      const timer = setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w.timer !== timer);
        reject(new Error('Peso inestable: espere a que la balanza se estabilice'));
      }, timeoutMs);
      waitersRef.current.push({ resolve, reject, timer });
    });
  }, []);

  // Reinicia polling si cambia protocolo/intervalo en caliente
  useEffect(() => {
    if (status === 'connected') startPolling();
  }, [config.protocol, config.pollIntervalMs, config.requestCommand, status, startPolling]);

  // Detecta desconexión física del cable USB
  useEffect(() => {
    if (!isWebSerialSupported()) return;
    const onDisconnect = (ev: Event) => {
      if ((ev.target as SerialPort) === portRef.current) {
        keepReadingRef.current = false;
        portRef.current = null;
        cleanupState();
        setStatus('disconnected');
      }
    };
    navigator.serial.addEventListener('disconnect', onDisconnect);
    return () => navigator.serial.removeEventListener('disconnect', onDisconnect);
  }, [cleanupState]);

  // Cierre limpio al desmontar
  useEffect(() => () => {
    keepReadingRef.current = false;
    stopPolling();
    void readerRef.current?.cancel().catch(() => undefined);
    void portRef.current?.close().catch(() => undefined);
    if (bleDeviceRef.current?.gatt?.connected) bleDeviceRef.current.gatt.disconnect();
  }, []);

  return {
    status: supported ? status : 'unsupported',
    reading,
    error,
    supported,
    connect,
    reconnect,
    disconnect,
    sendCommand,
    waitForStable,
  };
}
