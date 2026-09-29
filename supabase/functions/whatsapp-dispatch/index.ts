// =====================================================================
// Supabase Edge Function: whatsapp-dispatch
// Consume public.notification_outbox (comprobantes de abono y recordatorios de saldo vencido)
// y los envía por WhatsApp Cloud API (Meta) o reenvía a un webhook propio (n8n, Make, Twilio).
//
// Deploy:   supabase functions deploy whatsapp-dispatch
// Secrets:  supabase secrets set WA_TOKEN=... WA_PHONE_ID=...   (Meta Cloud API)
//           ó configure business_settings.whatsapp_webhook_url para reenviar a su webhook.
// Programar (pg_cron + pg_net) cada 5 min:
//   select cron.schedule('wa-dispatch', '*/5 * * * *', $$
//     select net.http_post(url := 'https://<ref>.functions.supabase.co/whatsapp-dispatch',
//                          headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>'));
//   $$);
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA_TOKEN = Deno.env.get('WA_TOKEN');
const WA_PHONE_ID = Deno.env.get('WA_PHONE_ID');

type Outbox = {
  id: string;
  phone: string | null;
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function render(o: Outbox, tradeName: string, symbol: string): string {
  const p = o.payload;
  const money = (v: unknown) => `${symbol} ${Number(v ?? 0).toFixed(2)}`;
  if (o.template === 'comprobante_abono') {
    return `*${tradeName}*\nHola ${p.cliente}, recibimos su abono de ${money(p.monto)} (${p.metodo}).\nSaldo pendiente: ${money(p.saldo)}.\n¡Gracias por su preferencia!`;
  }
  if (o.template === 'recordatorio_vencido') {
    return `*${tradeName}*\nHola ${p.cliente}, le recordamos que tiene un saldo de ${money(p.saldo)} vencido desde ${p.vencido_desde}. Puede abonar por Yape/Plin o en tienda. ¡Gracias!`;
  }
  return JSON.stringify(p);
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 9 ? `51${d}` : d; // Perú por defecto
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(SERVICE_KEY)) return new Response('Unauthorized', { status: 401 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: settings } = await db.from('business_settings').select('trade_name, currency_symbol, whatsapp_webhook_url').eq('id', 1).single();
  const { data: rows, error } = await db
    .from('notification_outbox')
    .select('id, phone, template, payload, attempts')
    .eq('status', 'pendiente')
    .lt('attempts', 5)
    .order('created_at')
    .limit(50);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const o of (rows ?? []) as Outbox[]) {
    if (!o.phone) continue;
    const text = render(o, settings?.trade_name ?? 'Carnicería', settings?.currency_symbol ?? 'S/');
    try {
      let res: Response;
      if (settings?.whatsapp_webhook_url) {
        res = await fetch(settings.whatsapp_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: normalizePhone(o.phone), text, template: o.template, payload: o.payload }),
        });
      } else if (WA_TOKEN && WA_PHONE_ID) {
        res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizePhone(o.phone), type: 'text', text: { body: text } }),
        });
      } else {
        throw new Error('Sin canal configurado (webhook o WA_TOKEN/WA_PHONE_ID)');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      await db.from('notification_outbox').update({ status: 'enviado', sent_at: new Date().toISOString(), attempts: o.attempts + 1 }).eq('id', o.id);
      sent++;
    } catch (e) {
      const attempts = o.attempts + 1;
      await db
        .from('notification_outbox')
        .update({ attempts, last_error: (e as Error).message, status: attempts >= 5 ? 'error' : 'pendiente' })
        .eq('id', o.id);
    }
  }
  return Response.json({ processed: rows?.length ?? 0, sent });
});
