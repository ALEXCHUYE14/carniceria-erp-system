import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import * as Tabs from '@radix-ui/react-tabs';
import { Building2, Cpu, ImageUp, Loader2, Printer, QrCode, Save, Scale, Usb, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ScaleDisplay } from '@/components/ScaleDisplay';
import { queryKeys, useSettings } from '@/hooks/useCatalog';
import { useScale } from '@/hooks/ScaleProvider';
import { isWebBluetoothSupported, isWebSerialSupported } from '@/hooks/useSerialScale';
import { useAuthStore } from '@/stores/authStore';
import { SCALE_PRESETS, useDeviceStore } from '@/stores/deviceStore';
import { buildSaleTicket, isWebUsbSupported, pairPrinter, printBytes } from '@/lib/hardware/escpos';
import { friendlyError, publicQrUrl, QR_BUCKET, supabase } from '@/lib/supabase';
import { ROLE_LABEL } from '@/lib/roles';
import { parseDecimal } from '@/lib/utils';
import type { BusinessSettings, Profile, UserRole } from '@/types';

const tabCls =
  'flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow';

export function SettingsPage() {
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  return (
    <Tabs.Root defaultValue={isAdmin ? 'business' : 'devices'} className="space-y-4 p-3 md:p-4">
      <Tabs.List className="scrollbar-thin flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:inline-flex">
        {isAdmin && <Tabs.Trigger value="business" className={tabCls}><Building2 className="size-4" /> Negocio</Tabs.Trigger>}
        {isAdmin && <Tabs.Trigger value="payments" className={tabCls}><QrCode className="size-4" /> Yape / Plin</Tabs.Trigger>}
        <Tabs.Trigger value="devices" className={tabCls}><Cpu className="size-4" /> Dispositivos</Tabs.Trigger>
        {isAdmin && <Tabs.Trigger value="users" className={tabCls}><Users className="size-4" /> Usuarios</Tabs.Trigger>}
      </Tabs.List>
      {isAdmin && <Tabs.Content value="business"><BusinessTab /></Tabs.Content>}
      {isAdmin && <Tabs.Content value="payments"><QrTab /></Tabs.Content>}
      <Tabs.Content value="devices"><DevicesTab /></Tabs.Content>
      {isAdmin && <Tabs.Content value="users"><UsersTab /></Tabs.Content>}
    </Tabs.Root>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const uid = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (patch: Partial<BusinessSettings>) => {
      const { error } = await supabase.from('business_settings').update({ ...patch, updated_by: uid }).eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Configuración guardada y propagada a todas las cajas');
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

// ---------------------------------------------------------------------
function BusinessTab() {
  const { data: s } = useSettings();
  const save = useSaveSettings();
  const [f, setF] = useState<Partial<BusinessSettings>>({});
  useEffect(() => {
    if (s) setF(s);
  }, [s]);
  if (!s) return <Loader2 className="animate-spin" />;

  const txt = (k: keyof BusinessSettings) => ({
    value: (f[k] as string | null | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Datos del negocio</CardTitle>
        <CardDescription>Aparecen en el ticket y se actualizan en vivo en todas las cajas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre comercial"><Input {...txt('trade_name')} /></Field>
        <Field label="Razón social"><Input {...txt('legal_name')} /></Field>
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <Field label="Doc.">
            <Select {...txt('tax_id_label')}>
              <option>RUC</option><option>NIT</option><option>RFC</option><option>RUT</option><option>CUIT</option>
            </Select>
          </Field>
          <Field label="Número"><Input {...txt('tax_id')} /></Field>
        </div>
        <Field label="Teléfono"><Input {...txt('phone')} /></Field>
        <Field label="Dirección" className="sm:col-span-2"><Input {...txt('address')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Moneda (ISO)"><Input {...txt('currency_code')} /></Field>
          <Field label="Símbolo"><Input {...txt('currency_symbol')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Impuesto"><Input {...txt('tax_name')} /></Field>
          <Field label="Tasa %"><Input inputMode="decimal" value={String(f.tax_rate ?? '')} onChange={(e) => setF({ ...f, tax_rate: parseDecimal(e.target.value) })} /></Field>
        </div>
        <Field label="Plazo de crédito por defecto (días)">
          <Input inputMode="numeric" value={String(f.default_credit_days ?? '')} onChange={(e) => setF({ ...f, default_credit_days: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Webhook WhatsApp (opcional)" hint="Edge Function o n8n que consume notification_outbox">
          <Input {...txt('whatsapp_webhook_url')} placeholder="https://…" />
        </Field>
        <Field label="Pie de ticket" className="sm:col-span-2"><Textarea {...txt('ticket_footer')} /></Field>
        <label className="flex items-center gap-3 rounded-lg border p-3">
          <input type="checkbox" className="size-5 accent-[#DC2626]" checked={!!f.prices_include_tax} onChange={(e) => setF({ ...f, prices_include_tax: e.target.checked })} />
          <span className="text-sm font-semibold">Precios incluyen {f.tax_name ?? 'impuesto'}</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border p-3">
          <input type="checkbox" className="size-5 accent-[#DC2626]" checked={!!f.allow_negative_stock} onChange={(e) => setF({ ...f, allow_negative_stock: e.target.checked })} />
          <span className="text-sm font-semibold">Permitir vender sin stock registrado</span>
        </label>
        <div className="sm:col-span-2">
          <Button
            variant="meat"
            disabled={save.isPending}
            onClick={() => {
              const { id: _id, updated_at: _u, yape_qr_path: _y, plin_qr_path: _p, ...patch } = f as BusinessSettings;
              save.mutate(patch);
            }}
          >
            <Save /> Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
function QrTab() {
  const { data: s } = useSettings();
  if (!s) return <Loader2 className="animate-spin" />;
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      <QrCard wallet="yape" settings={s} />
      <QrCard wallet="plin" settings={s} />
    </div>
  );
}

function QrCard({ wallet, settings }: { wallet: 'yape' | 'plin'; settings: BusinessSettings }) {
  const save = useSaveSettings();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [holder, setHolder] = useState((wallet === 'yape' ? settings.yape_holder : settings.plin_holder) ?? '');
  const [phone, setPhone] = useState((wallet === 'yape' ? settings.yape_phone : settings.plin_phone) ?? '');
  const path = wallet === 'yape' ? settings.yape_qr_path : settings.plin_qr_path;
  const url = publicQrUrl(path, settings.updated_at);

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('Seleccione una imagen');
    setBusy(true);
    try {
      // Compresión en el cliente: QR legible a 800px, < 200 KB, formato WebP
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 800,
        useWebWorker: true,
        fileType: 'image/webp',
        initialQuality: 0.9,
      });
      const newPath = `${wallet}/${Date.now()}.webp`;
      const { error } = await supabase.storage.from(QR_BUCKET).upload(newPath, compressed, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (error) throw error;
      await save.mutateAsync(wallet === 'yape' ? { yape_qr_path: newPath } : { plin_qr_path: newPath });
      if (path) await supabase.storage.from(QR_BUCKET).remove([path]); // limpiar el anterior
      toast.success(`QR ${wallet} actualizado (${Math.round(compressed.size / 1024)} KB)`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 capitalize">
          <span className={wallet === 'yape' ? 'text-[#742384]' : 'text-[#00B2A9]'}>●</span> {wallet}
        </CardTitle>
        <CardDescription>Se muestra en el modal de cobro de todas las cajas en tiempo real.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="mx-auto grid size-56 place-items-center overflow-hidden rounded-xl border bg-white">
          {url ? <img src={url} alt={`QR ${wallet}`} className="size-full object-contain" /> : <QrCode className="size-16 text-slate-300" />}
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImageUp />} {path ? 'Reemplazar QR' : 'Subir QR'}
        </Button>
        <Field label="Titular"><Input value={holder} onChange={(e) => setHolder(e.target.value)} /></Field>
        <Field label="Celular"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Button
          variant="burgundy"
          className="w-full"
          onClick={() => save.mutate(wallet === 'yape' ? { yape_holder: holder || null, yape_phone: phone || null } : { plin_holder: holder || null, plin_phone: phone || null })}
        >
          Guardar datos
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
function DevicesTab() {
  const scale = useScale();
  const { data: settings } = useSettings();
  const d = useDeviceStore();
  const [tare, setTare] = useState('T');

  const testPrint = async () => {
    if (!settings) return;
    try {
      await printBytes(
        buildSaleTicket(
          {
            business: settings,
            saleNumber: 'PRUEBA',
            date: new Date(),
            cashier: 'Sistema',
            terminal: d.terminalId,
            lines: [{ name: 'Lomo fino', qty: '1.250kg', unitPrice: 65, total: 81.25, detail: 'Corte: Fileteado fino' }],
            subtotal: 68.86,
            tax: 12.39,
            discount: 0,
            total: 81.25,
            payments: [{ label: 'Efectivo', amount: 100 }],
            change: 18.75,
          },
          { ...d.printer, openCashDrawer: false, copies: 1 },
        ),
      );
      toast.success('Ticket de prueba impreso');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scale className="size-5" /> Balanza</CardTitle>
          <CardDescription>
            Web Serial {isWebSerialSupported() ? <Badge tone="success">disponible</Badge> : <Badge tone="danger">no disponible</Badge>} · Web Bluetooth{' '}
            {isWebBluetoothSupported() ? <Badge tone="success">disponible</Badge> : <Badge tone="danger">no disponible</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScaleDisplay />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modelo / protocolo" className="sm:col-span-2">
              <Select value={d.scalePreset} onChange={(e) => d.applyPreset(e.target.value)}>
                {Object.entries(SCALE_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Conexión">
              <Select value={d.scale.transport} onChange={(e) => d.setScale({ transport: e.target.value as 'serial' | 'bluetooth' })}>
                <option value="serial">USB / RS-232 (Web Serial)</option>
                <option value="bluetooth">Bluetooth LE (UART)</option>
              </Select>
            </Field>
            <Field label="Modo">
              <Select value={d.scale.protocol} onChange={(e) => d.setScale({ protocol: e.target.value as 'continuous' | 'request' })}>
                <option value="continuous">Continuo (event-driven)</option>
                <option value="request">Por comando (polling)</option>
              </Select>
            </Field>
            <Field label="Baudios">
              <Select value={d.scale.baudRate} onChange={(e) => d.setScale({ baudRate: Number(e.target.value) })}>
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}
              </Select>
            </Field>
            <Field label="Datos / Paridad / Stop">
              <div className="flex gap-1">
                <Select value={d.scale.dataBits} onChange={(e) => d.setScale({ dataBits: Number(e.target.value) as 7 | 8 })}><option>7</option><option>8</option></Select>
                <Select value={d.scale.parity} onChange={(e) => d.setScale({ parity: e.target.value as 'none' | 'even' | 'odd' })}><option value="none">N</option><option value="even">E</option><option value="odd">O</option></Select>
                <Select value={d.scale.stopBits} onChange={(e) => d.setScale({ stopBits: Number(e.target.value) as 1 | 2 })}><option>1</option><option>2</option></Select>
              </div>
            </Field>
            {d.scale.protocol === 'request' && (
              <>
                <Field label="Comando de lectura" hint='Ej: P, W\r, \x05'><Input value={d.scale.requestCommand} onChange={(e) => d.setScale({ requestCommand: e.target.value })} className="font-mono" /></Field>
                <Field label="Intervalo (ms)"><Input inputMode="numeric" value={d.scale.pollIntervalMs} onChange={(e) => d.setScale({ pollIntervalMs: Math.max(100, Number(e.target.value) || 300) })} /></Field>
              </>
            )}
            <Field label="Lecturas para estabilidad"><Input inputMode="numeric" value={d.scale.stableReadings} onChange={(e) => d.setScale({ stableReadings: Math.max(2, Number(e.target.value) || 4) })} /></Field>
            <Field label="Tolerancia (kg)"><Input inputMode="decimal" value={d.scale.stableToleranceKg} onChange={(e) => d.setScale({ stableToleranceKg: parseDecimal(e.target.value) })} /></Field>
            <Field label="Unidad de la trama">
              <Select value={d.scale.unitDivisor} onChange={(e) => d.setScale({ unitDivisor: Number(e.target.value) })}>
                <option value={1}>Kilogramos</option>
                <option value={1000}>Gramos</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {scale.status === 'connected' ? (
              <Button variant="outline" onClick={() => void scale.disconnect()}>Desconectar</Button>
            ) : (
              <Button variant="bone" onClick={() => void scale.connect()}><Usb /> Conectar balanza</Button>
            )}
            <div className="flex gap-1">
              <Input value={tare} onChange={(e) => setTare(e.target.value)} className="w-20 font-mono" />
              <Button variant="secondary" disabled={scale.status !== 'connected'} onClick={() => scale.sendCommand(tare).catch((e: Error) => toast.error(e.message))}>Enviar (tara)</Button>
            </div>
          </div>
          {scale.reading && <p className="break-all rounded bg-muted p-2 font-mono text-xs">Trama: {scale.reading.raw}</p>}
          {scale.error && <p className="text-sm text-meat">{scale.error}</p>}
          <p className="text-xs text-muted-foreground">Al cambiar parámetros de puerto, desconecte y vuelva a conectar.</p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Printer className="size-5" /> Impresora térmica</CardTitle>
            <CardDescription>ESC/POS por WebUSB {isWebUsbSupported() ? <Badge tone="success">disponible</Badge> : <Badge tone="danger">no disponible</Badge>}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Papel">
                <Select value={d.printer.paperWidthChars} onChange={(e) => d.setPrinter({ paperWidthChars: Number(e.target.value) as 32 | 42 | 48 })}>
                  <option value={32}>58 mm (32 col.)</option>
                  <option value={42}>80 mm (42 col.)</option>
                  <option value={48}>80 mm (48 col.)</option>
                </Select>
              </Field>
              <Field label="Copias"><Input inputMode="numeric" value={d.printer.copies} onChange={(e) => d.setPrinter({ copies: Math.min(3, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            </div>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={d.printer.openCashDrawer} onChange={(e) => d.setPrinter({ openCashDrawer: e.target.checked })} /> Abrir gaveta de dinero</label>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={d.autoPrint} onChange={(e) => d.setAutoPrint(e.target.checked)} /> Imprimir automáticamente al cobrar</label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => pairPrinter().then(() => toast.success('Impresora vinculada')).catch((e: Error) => e.name !== 'NotFoundError' && toast.error(e.message))}>
                <Usb /> Vincular
              </Button>
              <Button variant="secondary" onClick={() => void testPrint()}>Imprimir prueba</Button>
            </div>
            <p className="text-xs text-muted-foreground">En Windows, si la impresora usa el driver del fabricante, reemplácelo por WinUSB (Zadig) para que el navegador pueda accederla.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Terminal</CardTitle></CardHeader>
          <CardContent>
            <Field label="Identificador de caja" hint="Se registra en cada venta para arqueo por caja">
              <Input value={d.terminalId} onChange={(e) => d.setTerminalId(e.target.value.toUpperCase())} className="font-mono" />
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function UsersTab() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.profile?.id);
  const { data: users = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const update = async (id: string, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) return toast.error(friendlyError(error));
    toast.success('Usuario actualizado');
    void qc.invalidateQueries({ queryKey: ['profiles'] });
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Usuarios y roles</CardTitle>
        <CardDescription>
          Cree las cuentas en Supabase &gt; Authentication &gt; Users (o por invitación). Aquí asigne el rol: el cajero solo registra ventas; el carnicero, despiece y lotes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
              <Input defaultValue={u.full_name} onBlur={(e) => e.target.value !== u.full_name && void update(u.id, { full_name: e.target.value })} className="h-10 max-w-60 flex-1" />
              <Select value={u.role} disabled={u.id === me} onChange={(e) => void update(u.id, { role: e.target.value as UserRole })} className="h-10 w-40">
                {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={u.id === me} checked={u.active} onChange={(e) => void update(u.id, { active: e.target.checked })} className="size-4" /> Activo
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
