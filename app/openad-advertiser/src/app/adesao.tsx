import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { AppText, Card, Icon, Row, Stack } from '@/components/ui/primitives';
import { errorMessage } from '@/api/errors';
import { useAuth } from '@/context/AuthContext';
import { colors, spacing } from '@/theme/tokens';

/**
 * Adesão: transforma a conta do ecossistema em anunciante.
 *
 * É uma tela e não um efeito automático porque é um ato: a chamada grava linha em
 * `openad.ad_advertisers`, que é cadastro de parceiro comercial e alimenta relatório de
 * faturamento. Fazer isso sozinho na primeira abertura transformaria qualquer passageiro
 * curioso em parceiro.
 *
 * Não há fila de aprovação — o vínculo nasce ativo. A moderação do openad é do **criativo**,
 * não do cadastro.
 */
export default function Adesao() {
  const { usuario, aderir, sair } = useAuth();
  const router = useRouter();
  const [razao, setRazao] = useState(usuario?.name ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const podeEnviar = razao.trim().length >= 2 && !enviando;

  async function enviar() {
    if (!podeEnviar) return;
    setErro(null);
    setEnviando(true);
    try {
      await aderir(razao.trim());
      router.replace('/campanhas');
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Screen>
      <Stack gap={16}>
        <AppText variant="title">Anunciar nos veículos</AppText>
        <AppText variant="small">
          Sua conta já está pronta. Falta só dizer com que nome o seu anúncio aparece — é o nome
          que a equipe de moderação vê e o que identifica você no relatório.
        </AppText>

        <Card>
          <Stack gap={12}>
            <TextField
              label="Nome ou razão social"
              value={razao}
              onChangeText={setRazao}
              placeholder="Padaria do Bairro LTDA"
              hint="Pode ser alterado depois."
              maxLength={180}
            />
            {erro ? (
              <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {erro}
              </AppText>
            ) : null}
            <Button
              title="Começar a anunciar"
              onPress={enviar}
              loading={enviando}
              disabled={!podeEnviar}
              size="lg"
            />
          </Stack>
        </Card>

        <Card>
          <Stack gap={8}>
            <AppText variant="label">Como funciona</AppText>
            {[
              'Você cria a campanha com orçamento, período e onde quer aparecer.',
              'Sobe o criativo (imagem ou vídeo) e envia para revisão.',
              'Aprovado, o anúncio entra no ar nas telas dos veículos.',
              'Você acompanha quantas vezes ele foi exibido de verdade.',
            ].map((t) => (
              <Row key={t} gap={spacing.sm}>
                <Icon name="checkmark-circle" size={16} color={colors.success} />
                <AppText variant="small" style={{ flex: 1 }}>
                  {t}
                </AppText>
              </Row>
            ))}
          </Stack>
        </Card>

        <Button title="Sair desta conta" variant="ghost" onPress={sair} />
      </Stack>
    </Screen>
  );
}
