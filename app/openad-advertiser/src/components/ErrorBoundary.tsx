import type { ErrorBoundaryProps } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme/tokens';
import { Button } from './ui/Button';
import { AppText, Icon } from './ui/primitives';

/** Fallback de erro de renderização (exportado pelas rotas). Nunca mostra stack trace ao usuário. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  console.error('Erro de renderização', error);
  return (
    <SafeAreaView
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.bg }}
    >
      <Icon name="alert-circle" size={48} color={colors.danger} />
      <AppText variant="subtitle" center>
        Algo deu errado nesta tela
      </AppText>
      <AppText variant="small" center>
        Tente de novo. Se o problema continuar, feche e abra o app.
      </AppText>
      <Button title="Tentar novamente" icon="refresh-outline" onPress={retry} />
    </SafeAreaView>
  );
}
