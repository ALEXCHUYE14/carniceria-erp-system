import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function formatMoney(value: number, symbol = 'S/'): string {
  return `${symbol} ${value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatKg(value: number, unit: 'kg' | 'und' = 'kg'): string {
  if (unit === 'und') return `${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })} und`;
  return `${value.toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value;
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function parseDecimal(input: string): number {
  const n = Number(input.replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}
