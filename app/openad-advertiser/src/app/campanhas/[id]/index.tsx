import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { campanhas as apiCampanhas } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import { errorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { QueryView } from '@/components/ui/States';
import { AppText, Badge, Card, Icon, KeyValue, Row, Stack } from '@/components/ui/primitives';
import { formatarCentavos, veiculacoesPrevistas } from '@/lib/dinheiro';
import { estadoDaCampanha, formatarData, formatarDataHora, proximoPasso } from '@/lib/formato';
import { colors, spacing } from '@/theme/tokens';

export default function DetalheDaCampanha() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: chaves.campanhas.detalhe(id),
    queryFn: ({ signal }) => apiCampanhas.obter(id, signal),
    enabled: Boolean(id),
  });

  const submeter = useMutation({
    mutationFn: () => apiCampanhas.submeter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.todas });
    },
    onError: (err) => setErro(errorMessage(err)),
  });

  return (
    <Screen onRefresh={() => consulta.refetch()} refreshing={consulta.isRefetching}>
      <QueryView query={consulta} loadingLabel="Carregando campanha…">
        {(c) => {
          const estado = estadoDaCampanha(c.status);
          const passo = proximoPasso(c);
          const podeSubmeter = c.status === 'draft' && c.creativeCount > 0;
          const previsao = veiculacoesPrevistas(
            c.budget.totalAmountCents,
            c.budget.ratePerImpressionCents
          );
          return (
            <Stack gap={spacing.lg}>
              <Row>
                <AppText variant="title" style={{ flex: 1 }}>
                  {c.name}
                </AppText>
                <Badge label={estado.rotulo} tone={estado.tom} />
              </Row>

              {passo ? (
                <Card
                  style={{
                    backgroundColor: c.status === 'rejected' ? colors.dangerSoft : colors.blueSoft,
                    borderColor: 'transparent',
                  }}
                >
                  <Row gap={spacing.sm}>
                    <Icon
                      name={c.status === 'rejected' ? 'close-circle' : 'information-circle'}
                      size={18}
                      color={c.status === 'rejected' ? colors.danger : colors.blue}
                    />
                    <AppText
                      variant="small"
                      color={c.status === 'rejected' ? colors.danger : colors.blue}
                      style={{ flex: 1 }}
                    >
                      {passo}
                    </AppText>
                  </Row>
                </Card>
              ) : null}

              <Card>
                <Stack gap={spacing.xs}>
                  <AppText variant="label">Investimento</AppText>
                  <KeyValue
                    label="Orçamento total"
                    value={formatarCentavos(c.budget.totalAmountCents, c.budget.currency)}
                    strong
                  />
                  <KeyValue
                    label="Por exibição"
                    value={formatarCentavos(c.budget.ratePerImpressionCents, c.budget.currency)}
                  />
                  <KeyValue
                    label="Exibições contratadas"
                    value={previsao.toLocaleString('pt-BR')}
                  />
                </Stack>
              </Card>

              <Card>
                <Stack gap={spacing.xs}>
                  <AppText variant="label">Período</AppText>
                  <KeyValue label="Início" value={formatarData(c.scheduledStart)} />
                  <KeyValue label="Fim" value={formatarData(c.scheduledEnd)} />
                </Stack>
              </Card>

              <Card>
                <Stack gap={spacing.sm}>
                  <AppText variant="label">Criativos</AppText>
                  <AppText variant="small">
                    {c.creativeCount === 0
                      ? 'Nenhum criativo enviado.'
                      : `${c.creativeCount} enviado${c.creativeCount > 1 ? 's' : ''}.`}
                  </AppText>
                  <Link href={`/campanhas/${c.campaignId}/criativo`} asChild>
                    <Button
                      title={c.creativeCount === 0 ? 'Subir criativo' : 'Subir outro criativo'}
                      variant="outline"
                      icon="cloud-upload-outline"
                    />
                  </Link>
                </Stack>
              </Card>

              {c.targeting.zoneIds.length > 0 || c.targeting.cities.length > 0 ? (
                <Card>
                  <Stack gap={spacing.xs}>
                    <AppText variant="label">Onde aparece</AppText>
                    {c.targeting.cities.length > 0 ? (
                      <KeyValue label="Cidades" value={c.targeting.cities.join(', ')} />
                    ) : null}
                    {c.targeting.zoneIds.length > 0 ? (
                      <KeyValue
                        label="Regiões"
                        value={`${c.targeting.zoneIds.length} selecionada${
                          c.targeting.zoneIds.length > 1 ? 's' : ''
                        }`}
                      />
                    ) : null}
                  </Stack>
                </Card>
              ) : null}

              {c.moderation ? (
                <Card>
                  <Stack gap={spacing.xs}>
                    <AppText variant="label">Revisão</AppText>
                    <KeyValue
                      label="Decisão"
                      value={c.moderation.decision === 'approved' ? 'Aprovada' : 'Recusada'}
                      valueColor={
                        c.moderation.decision === 'approved' ? colors.success : colors.danger
                      }
                      strong
                    />
                    <KeyValue label="Quando" value={formatarDataHora(c.moderation.reviewedAt)} />
                    {c.moderation.reason ? (
                      <AppText variant="small">{c.moderation.reason}</AppText>
                    ) : null}
                  </Stack>
                </Card>
              ) : null}

              {erro ? (
                <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                  {erro}
                </AppText>
              ) : null}

              {c.status === 'draft' ? (
                <Button
                  title="Enviar para revisão"
                  icon="send-outline"
                  size="lg"
                  loading={submeter.isPending}
                  disabled={!podeSubmeter || submeter.isPending}
                  onPress={() => {
                    setErro(null);
                    submeter.mutate();
                  }}
                  accessibilityHint={
                    podeSubmeter
                      ? 'A equipe revisa o criativo antes de o anúncio entrar no ar.'
                      : 'Suba um criativo antes de enviar para revisão.'
                  }
                />
              ) : null}

              <Link href={`/campanhas/${c.campaignId}/relatorio`} asChild>
                <Button title="Ver relatório de exibições" variant="outline" icon="stats-chart-outline" />
              </Link>
            </Stack>
          );
        }}
      </QueryView>
    </Screen>
  );
}
