import { useQuery } from '@tanstack/react-query';
import { Link, Stack as RotaStack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { campanhas as apiCampanhas } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import type { Campanha } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { EmptyState, QueryView } from '@/components/ui/States';
import { AppText, Badge, Card, Icon, Row, Stack } from '@/components/ui/primitives';
import { useAuth } from '@/context/AuthContext';
import { formatarCentavos } from '@/lib/dinheiro';
import { estadoDaCampanha, formatarData, proximoPasso } from '@/lib/formato';
import { colors, spacing } from '@/theme/tokens';

export default function ListaDeCampanhas() {
  const { anunciante } = useAuth();
  const router = useRouter();

  const consulta = useQuery({
    queryKey: chaves.campanhas.lista(1, 20),
    queryFn: ({ signal }) => apiCampanhas.listar(1, 20, signal),
  });

  return (
    <Screen
      onRefresh={() => consulta.refetch()}
      refreshing={consulta.isRefetching}
      footer={
        <Link href="/campanhas/nova" asChild>
          <Button title="Nova campanha" icon="add-circle-outline" size="lg" />
        </Link>
      }
    >
      <RotaStack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Conta"
              onPress={() => router.push('/conta')}
              hitSlop={8}
              style={{ paddingHorizontal: spacing.sm }}
            >
              <Icon name="person-circle-outline" size={26} color={colors.white} />
            </Pressable>
          ),
        }}
      />

      {anunciante ? (
        <AppText variant="small">Anunciando como {anunciante.legalName}</AppText>
      ) : null}

      <QueryView
        query={consulta}
        loadingLabel="Carregando campanhas…"
        isEmpty={(p) => p.data.length === 0}
        empty={
          <EmptyState
            icon="megaphone-outline"
            title="Nenhuma campanha ainda"
            message="Crie a primeira para começar a aparecer nas telas dos veículos."
          />
        }
      >
        {(pagina) => (
          <Stack gap={spacing.md}>
            {pagina.data.map((c) => (
              <CartaoDeCampanha key={c.campaignId} campanha={c} />
            ))}
            {pagina.pagination.total > pagina.data.length ? (
              <AppText variant="small" center>
                Mostrando {pagina.data.length} de {pagina.pagination.total}.
              </AppText>
            ) : null}
          </Stack>
        )}
      </QueryView>
    </Screen>
  );
}

function CartaoDeCampanha({ campanha }: { campanha: Campanha }) {
  const estado = estadoDaCampanha(campanha.status);
  const passo = proximoPasso(campanha);
  return (
    <Link href={`/campanhas/${campanha.campaignId}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Campanha ${campanha.name}`}>
        <Card>
          <Stack gap={spacing.sm}>
            <Row>
              <AppText variant="subtitle" style={{ flex: 1 }} numberOfLines={2}>
                {campanha.name}
              </AppText>
              <Badge label={estado.rotulo} tone={estado.tom} />
            </Row>

            <Row gap={spacing.lg}>
              <View style={styles.meia}>
                <AppText variant="caption">Orçamento</AppText>
                <AppText variant="bodyStrong">
                  {formatarCentavos(campanha.budget.totalAmountCents, campanha.budget.currency)}
                </AppText>
              </View>
              <View style={styles.meia}>
                <AppText variant="caption">Por exibição</AppText>
                <AppText variant="bodyStrong">
                  {formatarCentavos(
                    campanha.budget.ratePerImpressionCents,
                    campanha.budget.currency
                  )}
                </AppText>
              </View>
            </Row>

            <Row gap={spacing.sm}>
              <Icon name="calendar-outline" size={14} color={colors.textMuted} />
              <AppText variant="small">
                {formatarData(campanha.scheduledStart)} a {formatarData(campanha.scheduledEnd)}
              </AppText>
            </Row>

            <Row gap={spacing.sm}>
              <Icon name="image-outline" size={14} color={colors.textMuted} />
              <AppText variant="small">
                {campanha.creativeCount === 0
                  ? 'Sem criativo'
                  : `${campanha.creativeCount} criativo${campanha.creativeCount > 1 ? 's' : ''}`}
              </AppText>
            </Row>

            {passo ? (
              <AppText variant="small" color={colors.blue}>
                {passo}
              </AppText>
            ) : null}
          </Stack>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  meia: { flex: 1, gap: 2 },
});
