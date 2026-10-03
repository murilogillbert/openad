import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { campanhas as apiCampanhas, inventario as apiInventario } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import type { Zona } from '@/api/types';
import { errorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { AppText, Card, Icon, KeyValue, Row, Stack } from '@/components/ui/primitives';
import { centavosParaTexto, formatarCentavos, paraCentavos, veiculacoesPrevistas } from '@/lib/dinheiro';
import { dataBrParaIso } from '@/lib/formato';
import { colors, radius, spacing } from '@/theme/tokens';

/** Hoje e daqui a 30 dias, em `dd/mm/aaaa`, como ponto de partida razoável. */
function datasPadrao(): { inicio: string; fim: string } {
  const br = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const hoje = new Date();
  const fim = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { inicio: br(hoje), fim: br(fim) };
}

export default function NovaCampanha() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Função inline, e não `useMemo(datasPadrao, [])`: a regra `react-hooks/use-memo` exige
  // expressão inline para poder analisar as dependências estaticamente.
  const padrao = useMemo(() => datasPadrao(), []);

  const [nome, setNome] = useState('');
  const [inicio, setInicio] = useState(padrao.inicio);
  const [fim, setFim] = useState(padrao.fim);
  const [orcamento, setOrcamento] = useState(centavosParaTexto(50_000));
  const [tarifa, setTarifa] = useState(centavosParaTexto(25));
  const [zonasEscolhidas, setZonasEscolhidas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const zonas = useQuery({
    queryKey: chaves.inventario.zonas(),
    queryFn: ({ signal }) => apiInventario.zonas({}, signal),
    // A lista de zonas muda com a frota, não com a navegação: 10 minutos evita refazer a
    // consulta a cada abertura da tela.
    staleTime: 10 * 60_000,
  });

  const orcamentoCentavos = paraCentavos(orcamento);
  const tarifaCentavos = paraCentavos(tarifa);
  const isoInicio = dataBrParaIso(inicio, 0, 0);
  // Fim às 23:59 do dia escolhido: o anunciante informa um **dia**, e terminar à meia-noite
  // em ponto tiraria a campanha do ar no começo do último dia contratado.
  const isoFim = dataBrParaIso(fim, 23, 59);

  const previsao =
    orcamentoCentavos !== null && tarifaCentavos !== null
      ? veiculacoesPrevistas(orcamentoCentavos, tarifaCentavos)
      : 0;

  const problemas: string[] = [];
  if (nome.trim().length < 3) problemas.push('Dê um nome com pelo menos 3 letras.');
  if (!isoInicio) problemas.push('Data de início inválida (use dd/mm/aaaa).');
  if (!isoFim) problemas.push('Data de fim inválida (use dd/mm/aaaa).');
  if (isoInicio && isoFim && new Date(isoFim) <= new Date(isoInicio)) {
    problemas.push('A data de fim tem de ser depois da de início.');
  }
  if (orcamentoCentavos === null || orcamentoCentavos < 1) problemas.push('Informe o orçamento.');
  if (tarifaCentavos === null || tarifaCentavos < 1) problemas.push('Informe o valor por exibição.');
  if (orcamentoCentavos !== null && tarifaCentavos !== null && previsao < 1) {
    problemas.push('O orçamento não paga nem uma exibição com esse valor unitário.');
  }

  const criar = useMutation({
    mutationFn: () =>
      apiCampanhas.criar({
        name: nome.trim(),
        // Prioridade 50 (meio da escala de 1 a 100): é prioridade **entre as campanhas do
        // próprio anunciante**, não global. Expor isso na primeira tela pediria uma decisão
        // sem informação para decidir; fica para a edição.
        priority: 50,
        scheduledStart: isoInicio as string,
        scheduledEnd: isoFim as string,
        budget: {
          totalAmountCents: orcamentoCentavos as number,
          ratePerImpressionCents: tarifaCentavos as number,
          currency: 'BRL',
        },
        ...(zonasEscolhidas.length ? { targeting: { zoneIds: zonasEscolhidas } } : {}),
        // `driverPayout` omitido de propósito: ausente, a API aplica o piso de
        // `platform_config.monetization.driverPayoutMinPercent`. Pedir a porcentagem aqui
        // exporia uma decisão de política da plataforma a quem não tem contexto para
        // decidir — e o piso é o padrão que mantém o motorista pago.
      }),
    onSuccess: (campanha) => {
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.todas });
      // Vai direto para o criativo: sem ele a campanha não pode ser enviada para revisão, e
      // parar na lista deixaria o anunciante sem saber qual é o passo seguinte.
      router.replace(`/campanhas/${campanha.campaignId}/criativo`);
    },
    onError: (err) => setErro(errorMessage(err)),
  });

  return (
    <Screen
      footer={
        <Button
          title="Criar e subir criativo"
          size="lg"
          loading={criar.isPending}
          disabled={problemas.length > 0 || criar.isPending}
          onPress={() => {
            setErro(null);
            criar.mutate();
          }}
        />
      }
    >
      <Stack gap={spacing.lg}>
        <Card>
          <Stack gap={spacing.md}>
            <AppText variant="label">O anúncio</AppText>
            <TextField
              label="Nome da campanha"
              value={nome}
              onChangeText={setNome}
              placeholder="Promoção de outubro"
              hint="Só você e a equipe de revisão veem este nome."
            />
          </Stack>
        </Card>

        <Card>
          <Stack gap={spacing.md}>
            <AppText variant="label">Período</AppText>
            <Row gap={spacing.md}>
              <View style={styles.meia}>
                <TextField
                  label="Início"
                  value={inicio}
                  onChangeText={setInicio}
                  keyboardType="numbers-and-punctuation"
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                />
              </View>
              <View style={styles.meia}>
                <TextField
                  label="Fim"
                  value={fim}
                  onChangeText={setFim}
                  keyboardType="numbers-and-punctuation"
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                />
              </View>
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap={spacing.md}>
            <AppText variant="label">Quanto você quer investir</AppText>
            <TextField
              label="Orçamento total (R$)"
              value={orcamento}
              onChangeText={setOrcamento}
              keyboardType="decimal-pad"
              placeholder="500,00"
            />
            <TextField
              label="Valor por exibição (R$)"
              value={tarifa}
              onChangeText={setTarifa}
              keyboardType="decimal-pad"
              placeholder="0,25"
              hint="Você paga por exibição confirmada de verdade pelo equipamento."
            />
            {orcamentoCentavos !== null && tarifaCentavos !== null && previsao > 0 ? (
              <>
                <KeyValue
                  label="Exibições que o orçamento compra"
                  value={previsao.toLocaleString('pt-BR')}
                  strong
                />
                <AppText variant="small">
                  {formatarCentavos(orcamentoCentavos)} ÷ {formatarCentavos(tarifaCentavos)} por
                  exibição.
                </AppText>
              </>
            ) : null}
          </Stack>
        </Card>

        <Card>
          <Stack gap={spacing.md}>
            <AppText variant="label">Onde aparecer</AppText>
            <AppText variant="small">
              Sem escolher nenhuma região, o anúncio concorre em toda a frota.
            </AppText>
            {zonas.isPending ? (
              <AppText variant="small">Carregando regiões…</AppText>
            ) : zonas.error ? (
              <AppText variant="small" color={colors.textMuted}>
                Não foi possível carregar as regiões. A campanha pode ser criada sem escolher —
                você ajusta depois.
              </AppText>
            ) : (zonas.data ?? []).length === 0 ? (
              <AppText variant="small" color={colors.textMuted}>
                Nenhuma região cadastrada ainda. A campanha vale para toda a frota.
              </AppText>
            ) : (
              <View style={styles.fichas}>
                {(zonas.data ?? []).map((z) => (
                  <Ficha
                    key={z.zoneId}
                    zona={z}
                    ativa={zonasEscolhidas.includes(z.zoneId)}
                    onToggle={() =>
                      setZonasEscolhidas((atual) =>
                        atual.includes(z.zoneId)
                          ? atual.filter((x) => x !== z.zoneId)
                          : [...atual, z.zoneId]
                      )
                    }
                  />
                ))}
              </View>
            )}
          </Stack>
        </Card>

        {problemas.length > 0 ? (
          <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }}>
            <Stack gap={spacing.xs}>
              {problemas.map((p) => (
                <Row key={p} gap={spacing.sm}>
                  <Icon name="alert-circle-outline" size={14} color={colors.warning} />
                  <AppText variant="small" color={colors.warning} style={{ flex: 1 }}>
                    {p}
                  </AppText>
                </Row>
              ))}
            </Stack>
          </Card>
        ) : null}

        {erro ? (
          <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {erro}
          </AppText>
        ) : null}
      </Stack>
    </Screen>
  );
}

function Ficha({
  zona,
  ativa,
  onToggle,
}: {
  zona: Zona;
  ativa: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: ativa }}
      accessibilityLabel={`${zona.name}, ${zona.city}`}
      onPress={onToggle}
      style={[styles.ficha, ativa && styles.fichaAtiva]}
    >
      {ativa ? <Icon name="checkmark" size={14} color={colors.navy} /> : null}
      <AppText variant="small" color={ativa ? colors.navy : colors.text}>
        {zona.name}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meia: { flex: 1 },
  fichas: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ficha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fichaAtiva: { backgroundColor: colors.limeSoft, borderColor: colors.lime },
});
