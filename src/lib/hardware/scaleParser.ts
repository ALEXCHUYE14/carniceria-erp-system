// =====================================================================
// Parser de tramas de balanzas (Systel, Torrey, CAS, Kretz, Toledo)
// La mayoría envía ASCII con el peso y un indicador de estabilidad:
//   CAS:     "ST,GS,+  1.250kg\r\n"  (ST = estable, US = inestable)
//   Systel:  "\x02  1.250\x03" ó "P    1.250 kg"
//   Torrey:  "  1.250 kg\r"  (modo por comando "P")
//   Toledo:  "\x02 1250\r" en gramos (divisor 1000) o 8217 "\x02 01.250\r"
//   Kretz:   "PESO:   1,250 KG"
// =====================================================================

export interface ParsedFrame {
  weightKg: number;
  stableFlag: boolean | null; // null si la trama no informa estabilidad
  raw: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
const NUMBER_RE = /([-+]?)\s*(\d{1,6}(?:[.,]\d{1,4})?)/;

export function parseScaleFrame(frame: string, unitDivisor = 1): ParsedFrame | null {
  const clean = frame.replace(CONTROL_CHARS, ' ').trim();
  if (!clean) return null;

  // Tramas de sobrecarga / error típicas
  if (/OL|OVER|ERR|----/i.test(clean) && !NUMBER_RE.test(clean)) return null;

  const match = clean.match(NUMBER_RE);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  let value = Number((match[2] ?? '0').replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  const upper = clean.toUpperCase();
  // Unidad explícita en la trama tiene prioridad sobre el divisor configurado
  if (/\bG\b|\dG\s*$/.test(upper) && !/KG/.test(upper)) value = value / 1000;
  else if (/LB/.test(upper)) value = value * 0.45359237;
  else if (!/KG/.test(upper) && unitDivisor !== 1) value = value / unitDivisor;

  let stableFlag: boolean | null = null;
  if (/^ST\b|,ST,|\bST,/.test(upper)) stableFlag = true;
  if (/^US\b|,US,|\bUS,|MOTION|\bM\b/.test(upper)) stableFlag = false;

  return { weightKg: Math.round(sign * value * 1000) / 1000, stableFlag, raw: clean };
}

/**
 * Acumula bytes del stream y devuelve tramas completas.
 * Separa por CR/LF o por ETX (0x03), que usan la mayoría de fabricantes.
 */
export class FrameBuffer {
  private buffer = '';
  private readonly maxLength = 256;

  push(chunk: string): string[] {
    this.buffer += chunk;
    const frames: string[] = [];
    let idx: number;
    // eslint-disable-next-line no-control-regex
    const sep = /[\r\n\x03]/;
    while ((idx = this.buffer.search(sep)) >= 0) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (frame.trim()) frames.push(frame);
    }
    if (this.buffer.length > this.maxLength) this.buffer = this.buffer.slice(-this.maxLength);
    return frames;
  }

  reset() {
    this.buffer = '';
  }
}

/** Detector de estabilidad por ventana deslizante (para balanzas que no informan ST/US). */
export class StabilityDetector {
  private readings: number[] = [];

  constructor(private required: number, private toleranceKg: number) {}

  push(weight: number): boolean {
    this.readings.push(weight);
    if (this.readings.length > this.required) this.readings.shift();
    if (this.readings.length < this.required) return false;
    const min = Math.min(...this.readings);
    const max = Math.max(...this.readings);
    return max - min <= this.toleranceKg + 1e-9; // epsilon: evita falsos inestables por coma flotante
  }

  reset() {
    this.readings = [];
  }
}

/** Convierte "\x05", "\r" y similares escritos en configuración a bytes reales. */
export function decodeCommand(cmd: string): Uint8Array {
  const unescaped = cmd
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n');
  return new TextEncoder().encode(unescaped);
}
