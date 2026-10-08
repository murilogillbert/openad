import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { credito as apiCredito } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText, Card, KeyValue, Stack, Stat } from '@/components/ui/primitives';
import { env, links } from '@/config/env';
import { useAuth } from '@/context/AuthContext';
import { formatarCentavos } from '@/lib/dinheiro';
import { formatarData } from '@/lib/formato';
import { spacing } from '@/theme/tokens';

export default function Conta() {
  const { usuario, anunciante, sair } = useAuth();

  /**
   * Saldo é leitura, e a falha dela não pode esconder a tela.
   *
   * `retry: false` e nenhum tratamento de erro visível: se o saldo não carregar, o cartão
   * mostra um traço. Esta tela é também onde fica o botão de sair e o link do suporte — travar
   * tudo por causa de um número deixaria o anunciante sem como pedir ajuda.
   */
  const saldo = useQuery({
    queryKey: chaves.credito.saldo,
    queryFn: ({ signal }) => apiCredito.saldo(signal),
    enabled: Boolean(anunciante),
    retry: false,
  });

  return (
    <Screen>
      <Stack gap={spacing.lg}>
        <Card>
          <Stack gap={spacing.xs}>
            <AppText variant="label">Conta do ecossistema</AppText>
            <KeyValue label="Nome" value={usuario?.name ?? '—'} />
            <KeyValue label="E-mail" value={usuario?.email ?? '—'} />
            <AppText variant="small">
              É a mesma conta do OpenDriver e do OpenDriverHub. Alterar a senha em qualquer um
              vale nos três.
            </AppText>
          </Stack>
        </Card>

        {anunciante ? (
          <Card>
            <Stack gap={spacing.xs}>
              <AppText variant="label">Anunciante</AppText>
              <KeyValue label="Nome exibido" value={anunciante.legalName} />
              <KeyValue
                label="Situação"
                value={anunciante.status === 'active' ? 'Ativo' : anunciante.status}
              />
              <KeyValue label="Desde" value={formatarData(anunciante.createdAt)} />
            </Stack>
          </Card>
        ) : null}

        {anunciante ? (
          <Card>
            <Stack gap={spacing.sm}>
              <AppText variant="label">Crédito de veiculação</AppText>
              <Stat
                label="Disponível para reservar"
                value={
                  saldo.data ? formatarCentavos(Math.round(saldo.data.disponivel * 100)) : '—'
                }
                hint="É o que libera campanha no próximo ciclo."
                tone={saldo.data && saldo.data.disponivel <= 0 ? 'warning' : 'success'}
              />
              <Stat
                label="Reservado neste ciclo"
                value={saldo.data ? formatarCentavos(Math.round(saldo.data.retido * 100)) : '—'}
                hint="Já comprometido com campanha no ar. Não desapareceu: está em uso."
              />
              <AppText variant="small">
                A compra de crédito é no painel web. O app não cobra nada — abrir o painel leva
                você ao navegador, com a mesma conta.
              </AppText>
              {/*
                `openBrowserAsync` e não `Linking.openURL`: o navegador no app volta para cá
                quando a pessoa fecha, enquanto o externo deixaria o app no fundo. Depois de
                voltar, a tela reconsulta o saldo — é o caminho normal de quem acabou de pagar.
              */}
              <Button
                title="Abrir painel de crédito"
                variant="secondary"
                icon="open-outline"
                onPress={() => {
                  void WebBrowser.openBrowserAsync(links.creditPanel).finally(() => {
                    void saldo.refetch();
                  });
                }}
              />
            </Stack>
          </Card>
        ) : null}

        <Card>
          <Stack gap={spacing.sm}>
            <AppText variant="label">Ajuda e documentos</AppText>
            <Button
              title="Política de privacidade"
              variant="outline"
              icon="document-text-outline"
              onPress={() => WebBrowser.openBrowserAsync(links.privacyPolicy)}
            />
            <Button
              title="Termos de uso"
              variant="outline"
              icon="document-text-outline"
              onPress={() => WebBrowser.openBrowserAsync(links.terms)}
            />
            <Button
              title="Falar com o suporte"
              variant="outline"
              icon="mail-outline"
              onPress={() => Linking.openURL(`mailto:${links.supportEmail}`)}
            />
          </Stack>
        </Card>

        <Button title="Sair" variant="danger" icon="log-out-outline" onPress={sair} />

        {/* Útil no suporte: diz contra qual ambiente este APK fala, sem precisar de log. */}
        <AppText variant="small" center>
          {env.variant} · {env.adsApiUrl.replace(/^https?:\/\//, '')}
        </AppText>
      </Stack>
    </Screen>
  );
}
