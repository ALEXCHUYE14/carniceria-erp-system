# CarniPOS — ERP/POS para carnicerías y distribuidoras de carne

Sistema offline-first de punto de venta por peso, despiece con análisis de rendimiento, trazabilidad por lotes (FIFO) y cuentas corrientes (fiado), construido con **Vite + React 19 + TypeScript estricto**, **TanStack Query v5 + Zustand**, **Dexie (IndexedDB) + Workbox (PWA)** y **Supabase** (PostgreSQL, RLS, Storage, Realtime).

## Puesta en marcha

1. **Base de datos**: en Supabase → SQL Editor, ejecuta completo `supabase/schema.sql`. Es re-ejecutable.
2. **Primer usuario**: crea un usuario en Authentication → Users. El primero queda como **administrador**; los siguientes se crean como cajero **inactivo** y no pueden entrar hasta que el admin los active en *Ajustes → Usuarios*.
   **Importante:** desactiva el registro público en Authentication → Sign In / Providers → *Allow new users to sign up*.
3. **Variables**: copia `.env.example` a `.env.local` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. **Ejecutar**:
   ```bash
   npm install
   npm run dev        # desarrollo
   npm run build      # producción (dist/), desplegable en Vercel / Netlify / Cloudflare
   npm test           # pruebas unitarias (precios, rendimiento, parser de balanzas)
   npm run pack       # genera carniceria-erp-system.zip sin node_modules
   ```
5. **Configurar**: *Ajustes → Negocio* (RUC, IGV, pie de ticket), *Yape / Plin* (sube los QR) y *Dispositivos* (balanza e impresora por cada caja).

> Web Serial, Web Bluetooth y WebUSB requieren **Chrome o Edge** y **HTTPS** (o `localhost`). En Android funciona WebUSB y Bluetooth; Web Serial solo en escritorio.

## Estructura

```
supabase/
  schema.sql                     Esquema completo: tablas, triggers, RPC, RLS, storage, realtime, semillas
  functions/whatsapp-dispatch/   Edge Function que envía comprobantes y recordatorios por WhatsApp
src/
  types.ts                       Tipos de dominio (espejo del esquema)
  hooks/
    useSerialScale.ts            Balanza USB/RS-232 (Web Serial) y Bluetooth LE (UART)
    ScaleProvider.tsx            Conexión única compartida por POS y despiece
    useCatalog.ts                Consultas network-first con respaldo en IndexedDB
    useRealtimeSync.ts           Sincronización multiterminal (stock, precios, QR)
  lib/
    pricing.ts                   Motor de precios / merma / IGV / pagos mixtos
    yield.ts                     Rendimiento de canal y prorrateo de costo por valor comercial
    hardware/scaleParser.ts      Tramas Systel, Torrey, CAS, Kretz, Toledo
    hardware/escpos.ts           Tickets y etiquetas de lote ESC/POS por WebUSB
    offline/db.ts, sync.ts       Dexie + cola de ventas idempotente con reintentos
  stores/                        Zustand: carrito (persistente), dispositivos, sesión, sync
  features/
    pos/                         Caja: 3 columnas, captura de peso, cortes, cobro Yape/Plin/mixto/fiado
    yield/                       Recepción de canal + matriz de despiece
    lots/                        Trazabilidad camión → canal → lote → venta, etiquetas QR
    customers/                   Libreta digital, abonos, límites, cobranza por WhatsApp
    sales/                       Historial, anulación (admin), cola offline pendiente
    dashboard/                   Ventas vs costo, rendimiento por canal, balance de pérdidas
    products/                    Catálogo, categorías, tipos de corte y mermas
    settings/                    Negocio, QR, balanza, impresora, usuarios
pack-project.js                  Empaquetador ZIP
```

## Reglas de negocio clave

| Regla | Dónde vive |
|---|---|
| Stock en kg se descuenta al insertar `sale_items` (neto + merma de preparación) | Trigger `trg_sale_item_after_insert` |
| Consumo FIFO por vencimiento y fecha de ingreso, con registro en `sale_item_lots` | Mismo trigger |
| Saldo del cliente y vencimiento más antiguo se recalculan en cada movimiento | Trigger `trg_ledger_after_change` |
| Venta atómica e idempotente (reintentos offline no duplican) | RPC `create_sale(payload)` por `client_uuid` |
| Fiado valida límite de crédito y bloquea clientes con saldo vencido (salvo admin) | RPC `create_sale` |
| N° de operación Yape/Plin obligatorio y único (anti-fraude) | `CHECK` + índice único parcial |
| Rendimiento = Σ kg comerciales / kg gancho × 100; costo prorrateado por kg × factor de valor | RPC `process_carcass` y `lib/yield.ts` |
| Cajero solo inserta ventas y ve las propias; admin acceso total; carnicero despiece/lotes | Políticas RLS |
| Anulación revierte lotes, stock y cuenta corriente | RPC `void_sale` (solo admin) |
| Ventas, ítems y pagos solo se crean vía `create_sale` (sin INSERT directo por la API) | Políticas RLS |
| Rebaja total de un no-admin (precio de línea + descuento) ≤ `max_discount_pct` del precio de catálogo | RPC `create_sale` |
| Abonos idempotentes por `client_uuid` (un reintento offline no duplica el pago) | RPC `register_customer_payment` |
| Un turno abierto por caja; efectivo esperado = fondo + efectivo de ventas y abonos + ingresos − retiros | RPC `open_cash_session`, `cash_session_summary`, `close_cash_session` |

## Balanzas soportadas

Preconfiguradas en *Ajustes → Dispositivos*: CAS y Systel (modo continuo), Torrey (`P`), Toledo (`ENQ`, 7E1, gramos) y Kretz (`W\r`). Cualquier otra que envíe peso en ASCII funciona ajustando baudios, paridad, comando y unidad. La estabilidad se toma del indicador ST/US de la trama o, si no existe, de una ventana deslizante de lecturas.

## Arqueo de caja

En *Arqueo* el cajero abre el turno con el fondo inicial, registra retiros o ingresos de efectivo y, al terminar, ingresa el efectivo contado. El sistema calcula el esperado y muestra el faltante o sobrante. Mientras la caja esté cerrada (confirmado por el servidor) el POS no permite cobrar; sin conexión sí deja vender y esas ventas se suman al turno según su hora real al sincronizar.

## Offline

Catálogo, clientes, lotes y configuración se cachean en IndexedDB. Las ventas y abonos se guardan primero en una cola local y se envían a Supabase al recuperar señal (reconexión, cada 60 s y al volver a la pestaña). Si el servidor rechaza una venta offline (por ejemplo, límite de crédito), queda en *Ventas → Operaciones pendientes* para que el supervisor la reintente o descarte. El ticket en curso sobrevive a recargas y cortes de luz.

## Tareas programadas opcionales (pg_cron)

```sql
select cron.schedule('expirar-lotes', '5 0 * * *', 'select public.expire_lots()');
select cron.schedule('recordatorios', '0 9 * * *', 'select public.enqueue_overdue_reminders()');
```

## Nota fiscal

El ticket interno no reemplaza al comprobante electrónico SUNAT (boleta/factura). Para emisión electrónica, integra un OSE/PSE (Nubefact, Facturador SUNAT, etc.) leyendo la tabla `sales`.
