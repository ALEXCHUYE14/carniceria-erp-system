// =====================================================================
// ESC/POS driverless vía WebUSB — impresoras térmicas 58/80 mm
// (Epson TM, Xprinter, Bixolon, 3nStar, genéricas POS-58/POS-80)
// =====================================================================
import type { PrinterConfig } from '@/types';

const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private bytes: number[] = [];
  constructor(private width: number) {}

  private push(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }

  init() { return this.push(ESC, 0x40, ESC, 0x74, 16); } // reset + code page WPC1252 (tildes, ñ)
  align(a: 'left' | 'center' | 'right') { return this.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on: boolean) { return this.push(ESC, 0x45, on ? 1 : 0); }
  size(w: 1 | 2, h: 1 | 2) { return this.push(GS, 0x21, ((w - 1) << 4) | (h - 1)); }
  feed(lines = 1) { return this.push(ESC, 0x64, lines); }
  cut() { return this.push(GS, 0x56, 0x42, 0x00); }
  openDrawer() { return this.push(ESC, 0x70, 0x00, 0x19, 0xfa); }

  text(str: string) {
    // CP1252: los caracteres latinos básicos coinciden con Latin-1
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      this.bytes.push(code < 256 ? code : 0x3f);
    }
    return this;
  }

  line(str = '') { return this.text(str).push(0x0a); }
  hr(char = '-') { return this.line(char.repeat(this.width)); }

  /** Dos columnas: texto a la izquierda y monto alineado a la derecha. */
  pair(left: string, right: string) {
    const space = this.width - right.length;
    const l = left.length > space - 1 ? left.slice(0, space - 1) : left;
    return this.line(l + ' '.repeat(Math.max(space - l.length, 1)) + right);
  }

  wrap(str: string) {
    const words = str.split(/\s+/);
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length > this.width) {
        this.line(current.trim());
        current = w;
      } else current += ' ' + w;
    }
    if (current.trim()) this.line(current.trim());
    return this;
  }

  /** QR nativo (modelo 2) — soportado por la mayoría de térmicas modernas. */
  qr(data: string, moduleSize = 6) {
    const bytes = Array.from(new TextEncoder().encode(data));
    const len = bytes.length + 3;
    return this
      .push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00)
      .push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize)
      .push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)
      .push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes)
      .push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

// ---------------------------------------------------------------------
// Transporte WebUSB
// ---------------------------------------------------------------------
const PRINTER_CLASS = 0x07;
let cachedDevice: USBDevice | null = null;

export const isWebUsbSupported = () => typeof navigator !== 'undefined' && 'usb' in navigator;

async function openDevice(device: USBDevice): Promise<{ device: USBDevice; endpoint: number; iface: number }> {
  if (!device.opened) await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const cfg = device.configuration;
  if (!cfg) throw new Error('La impresora no expone configuración USB');

  for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out && (alt.interfaceClass === PRINTER_CLASS || alt.interfaceClass === 0xff)) {
        if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
        return { device, endpoint: out.endpointNumber, iface: iface.interfaceNumber };
      }
    }
  }
  throw new Error('No se encontró un endpoint de impresión (bulk OUT)');
}

/** Solicita al usuario elegir la impresora (requiere gesto del usuario). */
export async function pairPrinter(): Promise<USBDevice> {
  if (!isWebUsbSupported()) throw new Error('WebUSB no disponible. Use Chrome/Edge en escritorio o Android.');
  const device = await navigator.usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }, { classCode: 0xff }] });
  cachedDevice = device;
  return device;
}

async function getPrinter(): Promise<USBDevice> {
  if (cachedDevice) return cachedDevice;
  const devices = await navigator.usb.getDevices();
  const d = devices[0];
  if (!d) throw new Error('No hay impresora vinculada. Vincúlela en Configuración > Dispositivos.');
  cachedDevice = d;
  return d;
}

export async function printBytes(data: Uint8Array): Promise<void> {
  const { device, endpoint } = await openDevice(await getPrinter());
  // Envío por bloques para impresoras con buffer pequeño
  const CHUNK = 512;
  for (let i = 0; i < data.length; i += CHUNK) {
    const result = await device.transferOut(endpoint, data.slice(i, i + CHUNK));
    if (result.status !== 'ok') throw new Error(`Error de impresión USB: ${result.status}`);
  }
}

// ---------------------------------------------------------------------
// Ticket de venta
// ---------------------------------------------------------------------
export interface TicketData {
  business: {
    trade_name: string;
    tax_id_label: string;
    tax_id: string | null;
    address: string | null;
    phone: string | null;
    ticket_footer: string | null;
    currency_symbol: string;
    tax_name: string;
  };
  saleNumber: number | string;
  date: Date;
  cashier: string;
  terminal: string;
  customer?: string | null;
  lines: Array<{ name: string; qty: string; unitPrice: number; total: number; detail?: string | null }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payments: Array<{ label: string; amount: number }>;
  change: number;
  offline?: boolean;
}

export function buildSaleTicket(t: TicketData, cfg: PrinterConfig): Uint8Array {
  const money = (n: number) => `${t.business.currency_symbol}${n.toFixed(2)}`;
  const b = new EscPosBuilder(cfg.paperWidthChars).init();

  b.align('center').bold(true).size(2, 2).line(t.business.trade_name).size(1, 1).bold(false);
  if (t.business.tax_id) b.line(`${t.business.tax_id_label}: ${t.business.tax_id}`);
  if (t.business.address) b.wrap(t.business.address);
  if (t.business.phone) b.line(`Tel: ${t.business.phone}`);
  b.hr('=');
  b.align('left');
  b.pair(`Ticket N° ${t.saleNumber}`, t.date.toLocaleDateString('es-PE'));
  b.pair(`Caja: ${t.terminal}`, t.date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
  b.line(`Atendió: ${t.cashier}`);
  if (t.customer) b.line(`Cliente: ${t.customer}`);
  if (t.offline) b.bold(true).line('** EMITIDO SIN CONEXIÓN **').bold(false);
  b.hr();

  for (const l of t.lines) {
    b.bold(true).line(l.name).bold(false);
    b.pair(`  ${l.qty} x ${money(l.unitPrice)}`, money(l.total));
    if (l.detail) b.line(`  ${l.detail}`);
  }
  b.hr();
  if (t.discount > 0) b.pair('Descuento', `-${money(t.discount)}`);
  b.pair('Op. gravada', money(t.subtotal));
  b.pair(t.business.tax_name, money(t.tax));
  b.bold(true).size(1, 2).pair('TOTAL', money(t.total)).size(1, 1).bold(false);
  b.hr();
  for (const p of t.payments) b.pair(p.label, money(p.amount));
  if (t.change > 0) b.bold(true).pair('Vuelto', money(t.change)).bold(false);
  b.feed(1).align('center');
  if (t.business.ticket_footer) b.wrap(t.business.ticket_footer);
  b.line('Documento no válido como comprobante electrónico');
  b.feed(4).cut();
  if (cfg.openCashDrawer) b.openDrawer();

  const one = b.build();
  if (cfg.copies <= 1) return one;
  const out = new Uint8Array(one.length * cfg.copies);
  for (let i = 0; i < cfg.copies; i++) out.set(one, i * one.length);
  return out;
}

/** Etiqueta de lote con QR para trazabilidad en cámara frigorífica. */
export function buildLotLabel(
  lot: { lot_number: string; product: string; kg: number; expiry: string | null; senasa: string | null },
  cfg: PrinterConfig,
): Uint8Array {
  const b = new EscPosBuilder(cfg.paperWidthChars).init().align('center');
  b.bold(true).size(2, 1).line(lot.product).size(1, 1).bold(false);
  b.line(`Lote: ${lot.lot_number}`);
  b.line(`Peso: ${lot.kg.toFixed(3)} kg`);
  if (lot.expiry) b.line(`Vence: ${lot.expiry}`);
  if (lot.senasa) b.line(`SENASA: ${lot.senasa}`);
  b.feed(1).qr(`LOT:${lot.lot_number}`).feed(3).cut();
  return b.build();
}
