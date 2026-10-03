import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { campanhas as apiCampanhas } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import { Screen } from '@/components/ui/Screen';
import { EmptyState, QueryView } from '@/components/ui/States';
import { AppText, Card, KeyValue, Row, Stat, Stack } from '@/components/ui/primitives';
import { formatarCentavos } from '@/lib/dinheiro';
import { formatarData } from '@/lib/formato';
import { spacing } from '@/theme/tokens';

/**
 * Proof-of-play: quantas vezes o anúncio foi exibido **de verdade**.
 *
 * O número vem de `play_records` já reconciliados por duração e com antifraude aplicada — não
 * do que o equipamento reportou. É essa distinção que torna o relatório uma prova e não uma
 * estimativa, e é por isso que ela está escrita na tela.
 */
export default function Relatorio() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const consulta = useQuery({
    queryKey: chaves.campanhas.relatorio(id),
    queryFn: ({ signal }) => apiCampanhas.relatorio(id, undefined, undefined, signal),
    enabled: Boolean(id),
  });

  return (
    <Screen onRefresh={() => consulta.refetch()} refreshing={consulta.isRefetching}>
      <QueryView query={consulta} loadingLabel="Somando as exibições…">
        {(r) => (
          <Stack gap={spacing.lg}>
            <AppText variant="small">
              Período de {formatarData(r.window.from)} a {formatarData(r.window.to)}.
            </AppText>

            <Row gap={spacing.md} style={{ alignItems: 'stretch' }}>
              <Stat
                label="Exibições"
                value={r.impressions.toLocaleString('pt-BR')}
                hint="confirmadas pelo equipamento"
              />
              <Stat
                label="Veículos"
                value={r.reach.toLocaleString('pt-BR')}
                hint="exibiram ao menos uma vez"
              />
            </Row>

            <Card>
              <Stack gap={spacing.xs}>
                <AppText variant="label">Valor</AppText>
                <KeyValue
                  label="Total do período"
                  value={formatarCentavos(r.revenueTotalCents, r.currency)}
                  strong
                />
                {r.impressions > 0 ? (
                  <KeyValue
                    label="Média por exibição"
                    value={formatarCentavos(
                      Math.round(r.revenueTotalCents / r.impressions),
                      r.currency
                    )}
                  />
                ) : null}
              </Stack>
            </Card>

            {r.revenueLines.length > 0 ? (
              <Card>
                <Stack gap={spacing.xs}>
                  <AppText variant="label">Por faixa de região</AppText>
                  {r.revenueLines.map((l) => (
                    <KeyValue
                      key={l.label}
                      label={`${l.label} — ${l.plays.toLocaleString('pt-BR')} exibições`}
                      value={formatarCentavos(l.amountCents, r.currency)}
                    />
                  ))}
                </Stack>
              </Card>
            ) : null}

            {r.impressions === 0 ? (
              <View>
                <EmptyState
                  icon="hourglass-outline"
                  title="Nenhuma exibição ainda"
                  message="Quando o anúncio começar a tocar nos veículos, os números aparecem aqui. Só contam exibições confirmadas."
                />
              </View>
            ) : null}
          </Stack>
        )}
      </QueryView>
    </Screen>
  );
}
