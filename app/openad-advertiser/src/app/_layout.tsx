import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/context/AuthContext';
import { QueryProvider } from '@/context/QueryProvider';
import { colors } from '@/theme/tokens';

export { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * A ordem dos provedores importa: `QueryProvider` por fora de `AuthProvider`, porque o
 * contexto de autenticação usa `useQueryClient` para limpar o cache em login, logout e
 * adesão. Invertido, o `useQueryClient` lançaria na montagem.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <AuthProvider>
            {/* `backgroundColor` saiu da API do `expo-status-bar` no SDK 57: no Android a cor
                da barra agora vem do tema nativo (definida em `app.config.ts`). */}
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.navy },
                headerTintColor: colors.white,
                headerTitleStyle: { fontWeight: '700' },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ title: 'Entrar' }} />
              <Stack.Screen name="cadastro" options={{ title: 'Criar conta' }} />
              <Stack.Screen name="adesao" options={{ title: 'Anunciar', headerBackVisible: false }} />
              <Stack.Screen name="campanhas/index" options={{ title: 'Minhas campanhas' }} />
              <Stack.Screen name="campanhas/nova" options={{ title: 'Nova campanha' }} />
              <Stack.Screen name="campanhas/[id]/index" options={{ title: 'Campanha' }} />
              <Stack.Screen name="campanhas/[id]/criativo" options={{ title: 'Criativo' }} />
              <Stack.Screen
                name="campanhas/[id]/relatorio"
                options={{ title: 'Relatório de exibições' }}
              />
              <Stack.Screen name="conta" options={{ title: 'Conta' }} />
            </Stack>
          </AuthProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
