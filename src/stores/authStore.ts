import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Profile, UserRole } from '@/types';
import { supabase } from '@/lib/supabase';
import { getKV, setKV } from '@/lib/offline/db';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    // Sin red: usar el último perfil cacheado para permitir vender offline
    return (await getKV<Profile>(`profile:${userId}`)) ?? null;
  }
  await setKV(`profile:${userId}`, data);
  return data as Profile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const profile = session ? await loadProfile(session.user.id) : null;
    set({ session, profile, loading: false });

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!newSession) {
        set({ session: null, profile: null });
        return;
      }
      if (newSession.user.id !== get().session?.user.id || !get().profile) {
        set({ session: newSession, profile: await loadProfile(newSession.user.id) });
      } else {
        set({ session: newSession });
      }
    });
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await loadProfile(data.user.id);
    if (!profile?.active) {
      await supabase.auth.signOut();
      throw new Error('Usuario inactivo. Contacte al administrador.');
    }
    set({ session: data.session, profile });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  hasRole: (...roles) => {
    const role = get().profile?.role;
    return !!role && roles.includes(role);
  },
}));
