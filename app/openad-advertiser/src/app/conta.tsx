import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText, Card, KeyValue, Stack } from '@/components/ui/primitives';
import { env, links } from '@/config/env';
import { useAuth } from '@/context/AuthContext';
import { formatarData } from '@/lib/formato';
import { spacing } from '@/theme/tokens';

export default function Conta() {
  const { usuario, anunciante, sair } = useAuth();

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
