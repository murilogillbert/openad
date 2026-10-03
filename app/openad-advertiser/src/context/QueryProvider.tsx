import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { ApiError } from '@/api/errors';

// No React Native não há window focus/online: liga os gerenciadores do
// TanStack Query ao AppState (volta do background) e ao NetInfo.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    // isInternetReachable null = ainda testando; só considera offline com certeza.
    setOnline(state.isConnected !== false && state.isInternetReachable !== false);
  }),
);

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // Não insiste em erros definitivos (4xx): só em falhas transitórias.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.isTransient) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Mutations mexem com dinheiro/estoque: nunca repetem sozinhas.
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);

  useEffect(() => {
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
