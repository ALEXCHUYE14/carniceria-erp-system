import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { startSyncEngine } from '@/lib/offline/sync';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ScaleProvider } from '@/hooks/ScaleProvider';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { PosPage } from '@/features/pos/PosPage';

// Módulos administrativos con carga diferida (el POS carga primero y rápido)
const YieldPage = lazy(() => import('@/features/yield/YieldPage').then((m) => ({ default: m.YieldPage })));
const LotsPage = lazy(() => import('@/features/lots/LotsPage').then((m) => ({ default: m.LotsPage })));
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const SalesPage = lazy(() => import('@/features/sales/SalesPage').then((m) => ({ default: m.SalesPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const CashPage = lazy(() => import('@/features/cash/CashPage').then((m) => ({ default: m.CashPage })));
const ProductsPage = lazy(() => import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
import type { UserRole } from '@/types';
import { homeFor } from '@/lib/roles';

function Protected({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { session, profile, loading } = useAuthStore();
  if (loading) return <FullScreenLoader />;
  if (!session || !profile) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>;
}

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center bg-industrial text-white">
      <Loader2 className="size-10 animate-spin text-meat" />
    </div>
  );
}

function MissingConfig() {
  return (
    <div className="flex h-full items-center justify-center bg-industrial p-6 text-white">
      <div className="max-w-md space-y-3 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-xl font-bold">Falta configurar Supabase</h1>
        <p className="text-sm text-white/70">
          Copia <code className="rounded bg-black/40 px-1">.env.example</code> a <code className="rounded bg-black/40 px-1">.env.local</code>,
          completa <b>VITE_SUPABASE_URL</b> y <b>VITE_SUPABASE_ANON_KEY</b>, ejecuta <code>supabase/schema.sql</code> en el SQL Editor y reinicia
          <code className="ml-1 rounded bg-black/40 px-1">npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void init();
    return startSyncEngine();
  }, [init]);

  if (!isSupabaseConfigured) return <MissingConfig />;

  return (
    <BrowserRouter>
      <ScaleProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Protected>
                <AppShell />
              </Protected>
            }
          >
            <Route path="/pos" element={<Protected roles={['admin', 'cajero']}><PosPage /></Protected>} />
            <Route path="/arqueo" element={<Protected roles={['admin', 'cajero']}><CashPage /></Protected>} />
            <Route path="/ventas" element={<Protected roles={['admin', 'cajero']}><SalesPage /></Protected>} />
            <Route path="/clientes" element={<Protected roles={['admin', 'cajero']}><CustomersPage /></Protected>} />
            <Route path="/despiece" element={<Protected roles={['admin', 'carnicero']}><YieldPage /></Protected>} />
            <Route path="/lotes" element={<Protected><LotsPage /></Protected>} />
            <Route path="/productos" element={<Protected roles={['admin']}><ProductsPage /></Protected>} />
            <Route path="/dashboard" element={<Protected roles={['admin']}><DashboardPage /></Protected>} />
            <Route path="/configuracion" element={<Protected><SettingsPage /></Protected>} />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </ScaleProvider>
    </BrowserRouter>
  );
}

function RootRedirect() {
  const { profile, loading } = useAuthStore();
  if (loading) return <FullScreenLoader />;
  return <Navigate to={profile ? homeFor(profile.role) : '/login'} replace />;
}
