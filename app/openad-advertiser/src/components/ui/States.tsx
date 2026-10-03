import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ApiError, errorMessage } from '@/api/errors';
import { colors, spacing } from '@/theme/tokens';
import { Button } from './Button';
import { AppText, Icon, type IconName } from './primitives';

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLabel={label} accessible>
      <ActivityIndicator size="large" color={colors.blue} />
      <AppText variant="small">{label}</AppText>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconBubble}>
        <Icon name={icon} size={28} color={colors.textMuted} />
      </View>
      <AppText variant="subtitle" center>
        {title}
      </AppText>
      {message ? (
        <AppText variant="small" center>
          {message}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout');
  return (
    <EmptyState
      icon={offline ? 'cloud-offline-outline' : 'alert-circle'}
      title={offline ? 'Sem conexão' : 'Não foi possível carregar'}
      message={errorMessage(error)}
      action={onRetry ? <Button title="Tentar novamente" variant="outline" icon="refresh-outline" onPress={onRetry} /> : null}
    />
  );
}

/**
 * Renderiza loading/erro/vazio de uma query e só chama `children` com dado
 * pronto — nenhuma tela acessa `query.data` sem checar antes.
 */
export function QueryView<T>({
  query,
  children,
  isEmpty,
  empty,
  loadingLabel,
}: {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'refetch'>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <LoadingState label={loadingLabel} />;
  if (query.error && query.data === undefined) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return <LoadingState label={loadingLabel} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="Nada por aqui ainda" />}</>;
  return <>{children(query.data)}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    minHeight: 240,
  },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
