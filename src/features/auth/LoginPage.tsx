import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Beef, Loader2, LogIn, MessageCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { friendlyError } from '@/lib/supabase';
import { homeFor } from '@/lib/roles';
import { supportWhatsAppUrl } from '@/lib/support';

// Servida desde public/; BASE_URL mantiene la ruta correcta si la app se publica en un subdirectorio
const LOGIN_BACKGROUND = `${import.meta.env.BASE_URL}img/portada.jpg`;

export function LoginPage() {
  const { session, profile, signIn } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (session && profile) return <Navigate to={homeFor(profile.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      const p = useAuthStore.getState().profile;
      navigate(p ? homeFor(p.role) : '/pos', { replace: true });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dark relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,#4A0E17_0%,#0F172A_60%)] p-4 lg:items-end lg:pr-[8vw]">
      {/* Portada: si no carga, queda visible el degradado del contenedor */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${LOGIN_BACKGROUND}")` }}
      />
      {/* Velo: oscuro en móvil para leer el formulario; en PC deja ver el logo a la izquierda */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-slate-950/75 lg:bg-transparent lg:bg-gradient-to-r lg:from-slate-950/10 lg:via-slate-950/35 lg:to-slate-950/85"
      />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-5">
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={submit}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-industrial/80 p-6 text-white shadow-2xl backdrop-blur"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-meat shadow-lg shadow-meat/30">
              <Beef className="size-9" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">CarniPOS</h1>
              <p className="text-sm text-white/60">ERP · Punto de venta · Trazabilidad</p>
            </div>
          </div>
          <Field label="Correo">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="border-white/15 bg-white/5 text-white" />
          </Field>
          <Field label="Contraseña">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="border-white/15 bg-white/5 text-white" />
          </Field>
          <Button type="submit" variant="meat" size="lg" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
            Ingresar
          </Button>
        </motion.form>

        <div className="flex flex-col items-center gap-3 text-center text-sm">
          <p className="flex items-center gap-1.5 text-white/70 drop-shadow">
            <ShieldCheck className="size-4 shrink-0" />
            Acceso exclusivo del personal autorizado
          </p>
          <a
            href={supportWhatsAppUrl(email)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-emerald-400 drop-shadow transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <MessageCircle className="size-4 shrink-0" />
            ¿Problemas para acceder? Contactar soporte
          </a>
        </div>
      </div>
    </div>
  );
}
