// =====================================================================
// Contacto de soporte técnico (WhatsApp) mostrado en el login
// =====================================================================

/** Número por defecto (Perú). Se puede sobrescribir con VITE_SUPPORT_WHATSAPP en .env.local. */
const DEFAULT_SUPPORT_PHONE = '51924996961';

/** Normaliza a formato internacional sin "+": 9 dígitos → prefijo 51 (Perú). */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 9) return `51${digits}`;
  // E.164 admite hasta 15 dígitos; menos de 10 no es un número internacional válido
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export const SUPPORT_WHATSAPP =
  normalizeWhatsAppPhone(import.meta.env.VITE_SUPPORT_WHATSAPP) ?? DEFAULT_SUPPORT_PHONE;

/** Enlace wa.me con un mensaje prellenado; incluye el correo si el usuario ya lo escribió. */
export function supportWhatsAppUrl(email?: string): string {
  const user = email?.trim();
  const text = user
    ? `Hola, tengo problemas para acceder a CarniPOS. Mi usuario es: ${user}`
    : 'Hola, tengo problemas para acceder a CarniPOS.';
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}
