import { create } from 'zustand';

interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  setOnline: (v: boolean) => void;
  setSyncing: (v: boolean) => void;
  setCounters: (pending: number, failed: number) => void;
  setLastSync: (iso: string) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  failed: 0,
  lastSync: null,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setCounters: (pending, failed) => set({ pending, failed }),
  setLastSync: (lastSync) => set({ lastSync }),
}));
