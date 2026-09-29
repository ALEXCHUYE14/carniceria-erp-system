import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppPhone, supportWhatsAppUrl } from '../support';

describe('contacto de soporte por WhatsApp', () => {
  it('normaliza números peruanos e internacionales', () => {
    expect(normalizeWhatsAppPhone('924996961')).toBe('51924996961');
    expect(normalizeWhatsAppPhone('+51 924 996 961')).toBe('51924996961');
    expect(normalizeWhatsAppPhone('51924996961')).toBe('51924996961');
    expect(normalizeWhatsAppPhone('123')).toBeNull();
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
  });

  it('arma el enlace wa.me con mensaje codificado', () => {
    const url = new URL(supportWhatsAppUrl());
    expect(url.origin + url.pathname).toBe('https://wa.me/51924996961');
    expect(url.searchParams.get('text')).toBe('Hola, tengo problemas para acceder a CarniPOS.');
  });

  it('incluye el correo escrito (sin espacios) y nunca la contraseña', () => {
    const url = new URL(supportWhatsAppUrl('  cajero+1@tienda.pe '));
    expect(url.searchParams.get('text')).toBe('Hola, tengo problemas para acceder a CarniPOS. Mi usuario es: cajero+1@tienda.pe');
  });
});
