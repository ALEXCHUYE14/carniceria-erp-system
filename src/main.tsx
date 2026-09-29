import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count) => navigator.onLine && count < 2,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst', // no bloquear queries sin red: los queryFn caen a IndexedDB
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster richColors position="top-center" closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
