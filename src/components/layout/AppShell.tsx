import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3, Beef, Boxes, Cloud, CloudOff, LogOut, Moon, Package, Receipt, RefreshCw, Scale, Settings, ShoppingCart, Sun, Users,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useScale } from '@/hooks/ScaleProvider';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useSettings } from '@/hooks/useCatalog';
import { syncOutbox } from '@/lib/offline/sync';
import { ROLE_LABEL } from '@/lib/roles';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types';
import { UpdatePrompt } from './UpdatePrompt';

interface NavItem {
  to: string;
  label: string;
  icon: typeof ShoppingCart;
  roles: UserRole[];
  industrial?: boolean; // pantallas en modo oscuro industrial
}

const NAV: NavItem[] = [
  { to: '/pos', label: 'Caja', icon: ShoppingCart, roles: ['admin', 'cajero'], industrial: true },
  { to: '/despiece', label: 'Despiece', icon: Beef, roles: ['admin', 'carnicero'], industrial: true },
  { to: '/lotes', label: 'Lotes', icon: Boxes, roles: ['admin', 'cajero', 'carnicero'] },
  { to: '/clientes', label: 'Clientes', icon: Users, roles: ['admin', 'cajero'] },
  { to: '/ventas', label: 'Ventas', icon: Receipt, roles: ['admin', 'cajero'] },
  { to: '/productos', label: 'Productos', icon: Package, roles: ['admin'] },
  { to: '/dashboard', label: 'Panel', icon: BarChart3, roles: ['admin'] },
  { to: '/configuracion', label: 'Ajustes', icon: Settings, roles: ['admin', 'cajero', 'carnicero'] },
];

type ThemePref = 'auto' | 'light' | 'dark';

export function AppShell() {
  const { profile, signOut } = useAuthStore();
  const location = useLocation();
  const { data: settings } = useSettings();
  const [themePref, setThemePref] = useState<ThemePref>(() => (localStorage.getItem('carni-theme') as ThemePref) ?? 'auto');

  useRealtimeSync(true);

  const items = NAV.filter((n) => profile && n.roles.includes(profile.role));
  const current = NAV.find((n) => location.pathname.startsWith(n.to));

  // Modo oscuro industrial automático en Caja/Despiece; claro comercial en administración
  const dark = themePref === 'dark' || (themePref === 'auto' && !!current?.industrial);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F172A' : '#4A0E17');
  }, [dark]);

  const cycleTheme = () => {
    const next: ThemePref = themePref === 'auto' ? 'light' : themePref === 'light' ? 'dark' : 'auto';
    localStorage.setItem('carni-theme', next);
    setThemePref(next);
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar tablet/PC */}
      <aside className="hidden w-20 shrink-0 flex-col items-center gap-1 border-r bg-burgundy py-3 text-white md:flex lg:w-56 lg:items-stretch lg:px-3">
        <div className="mb-4 flex items-center gap-2 px-1">
          <div className="grid size-10 place-items-center rounded-lg bg-meat font-black">
            <Beef className="size-6" />
          </div>
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-bold">{settings?.trade_name ?? 'Carnicería'}</p>
            <p className="truncate text-xs text-white/60">{profile ? ROLE_LABEL[profile.role] : ''}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex h-12 items-center justify-center gap-3 rounded-lg px-3 text-sm font-semibold text-white/75 transition lg:justify-start',
                  'hover:bg-white/10 hover:text-white',
                  isActive && 'bg-white/15 text-white shadow-inner',
                )
              }
              title={item.label}
            >
              <item.icon className="size-5 shrink-0" />
              <span className="hidden lg:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-col gap-1">
          <button onClick={cycleTheme} className="flex h-11 items-center justify-center gap-3 rounded-lg px-3 text-sm text-white/75 hover:bg-white/10 lg:justify-start" title="Tema">
            {dark ? <Moon className="size-5" /> : <Sun className="size-5" />}
            <span className="hidden lg:inline">Tema: {themePref === 'auto' ? 'automático' : themePref === 'dark' ? 'oscuro' : 'claro'}</span>
          </button>
          <button onClick={() => void signOut()} className="flex h-11 items-center justify-center gap-3 rounded-lg px-3 text-sm text-white/75 hover:bg-white/10 lg:justify-start" title="Salir">
            <LogOut className="size-5" />
            <span className="hidden lg:inline">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <StatusBar title={current?.label ?? ''} onTheme={cycleTheme} dark={dark} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        {/* Navegación inferior móvil */}
        <nav className="pb-safe grid shrink-0 border-t bg-card md:hidden" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, minmax(0, 1fr))` }}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn('flex h-14 min-w-[72px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted-foreground', isActive && 'text-primary')
              }
            >
              <item.icon className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <UpdatePrompt />
    </div>
  );
}

function StatusBar({ title, onTheme, dark }: { title: string; onTheme: () => void; dark: boolean }) {
  const { online, syncing, pending, failed } = useSyncStore();
  const scale = useScale();
  const { signOut } = useAuthStore();

  const scaleTone =
    scale.status === 'connected' ? 'text-emerald-500' : scale.status === 'error' ? 'text-meat' : 'text-muted-foreground';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      <h1 className="truncate text-base font-bold">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
        <span className={cn('flex items-center gap-1 rounded-full px-2 py-1', scaleTone)} title={`Balanza: ${scale.status}`}>
          <Scale className="size-4" />
          <span className="hidden sm:inline">{scale.status === 'connected' ? 'Balanza' : 'Sin balanza'}</span>
        </span>
        <button
          onClick={() => void syncOutbox()}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1',
            online ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-bone/20 text-bone-dark dark:text-bone',
          )}
          title="Sincronizar ahora"
        >
          {syncing ? <RefreshCw className="size-4 animate-spin" /> : online ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
          <span>{online ? 'En línea' : 'Sin conexión'}</span>
          {pending > 0 && <span className="rounded-full bg-bone px-1.5 text-burgundy-950">{pending}</span>}
          {failed > 0 && <span className="rounded-full bg-meat px-1.5 text-white">{failed}!</span>}
        </button>
        <button onClick={onTheme} className="rounded-full p-2 hover:bg-muted md:hidden" aria-label="Tema">
          {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
        <button onClick={() => void signOut()} className="rounded-full p-2 hover:bg-muted md:hidden" aria-label="Salir">
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
