import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { criativo as apiCriativo } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import { errorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText, Card, Icon, Row, Stack } from '@/components/ui/primitives';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * Formatos que a API aceita por padrão (`DEFAULT_ALLOWED_MIME` em `upload-session.service.ts`).
 *
 * A lista é repetida aqui **só para filtrar o seletor e dar mensagem antecipada** — a verdade
 * continua no servidor, que devolve `UNSUPPORTED_MEDIA_TYPE`. Filtrar na origem evita o
 * caminho mais frustrante: escolher um arquivo de 80 MB, esperar o envio e levar erro no fim.
 */
const ACEITOS = ['video/mp4', 'image/jpeg', 'image/png'];

type Passo = 'escolher' | 'abrindo' | 'enviando' | 'validando' | 'pronto';

const rotulos: Record<Passo, string> = {
  escolher: '',
  abrindo: 'Abrindo a sessão de envio…',
  enviando: 'Enviando o arquivo…',
  validando: 'Verificando o arquivo…',
  pronto: 'Criativo aprovado.',
};

export default function Criativo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [arquivo, setArquivo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [passo, setPasso] = useState<Passo>('escolher');
  const [erro, setErro] = useState<string | null>(null);

  const ocupado = passo === 'abrindo' || passo === 'enviando' || passo === 'validando';

  async function escolher() {
    setErro(null);
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      setErro('Precisamos de acesso às suas fotos e vídeos para enviar o criativo.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      // Sem edição: recortar um criativo DOOH na mão quebraria a proporção que o ruleset
      // exige, e o erro só apareceria na validação do servidor.
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    if (r.canceled || !r.assets[0]) return;

    const asset = r.assets[0];
    const tipo = tipoDe(asset);
    if (!ACEITOS.includes(tipo)) {
      setErro(
        `Formato não aceito (${tipo}). Use vídeo MP4, ou imagem JPEG ou PNG.`
      );
      setArquivo(null);
      return;
    }
    setArquivo(asset);
    setPasso('escolher');
  }

  /**
   * Três chamadas, na ordem que a API exige: abre a sessão, envia os bytes, conclui.
   *
   * Cada passo tem o próprio rótulo na tela porque o terceiro pode levar segundos (é ele que
   * roda o `ffprobe` contra o ruleset DOOH) e pode **falhar depois** de o arquivo já ter
   * subido. Uma barra genérica de "enviando" faria essa falha parecer erro de rede.
   */
  async function enviar() {
    if (!arquivo) return;
    setErro(null);
    const tipo = tipoDe(arquivo);
    const nome = nomeDe(arquivo, tipo);

    try {
      setPasso('abrindo');
      const sessao = await apiCriativo.abrirSessao(id, nome, tipo);
      const sessionId = sessao.data.sessionId;

      setPasso('enviando');
      const form = new FormData();
      // No React Native o `FormData` aceita `{ uri, name, type }`; não existe `File`.
      form.append('file', {
        uri: arquivo.uri,
        name: nome,
        type: tipo,
      } as unknown as Blob);
      await apiCriativo.enviarBytes(id, sessionId, form);

      setPasso('validando');
      await apiCriativo.concluir(id, sessionId);

      setPasso('pronto');
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.todas });
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.detalhe(id) });
    } catch (err) {
      setErro(errorMessage(err));
      setPasso('escolher');
    }
  }

  return (
    <Screen
      footer={
        passo === 'pronto' ? (
          <Button
            title="Voltar para a campanha"
            size="lg"
            icon="arrow-back-outline"
            onPress={() => router.replace(`/campanhas/${id}`)}
          />
        ) : (
          <Button
            title="Enviar criativo"
            size="lg"
            icon="cloud-upload-outline"
            loading={ocupado}
            disabled={!arquivo || ocupado}
            onPress={enviar}
          />
        )
      }
    >
      <Stack gap={spacing.lg}>
        <AppText variant="title">Criativo do anúncio</AppText>
        <AppText variant="small">
          Vídeo MP4 ou imagem JPEG/PNG. O arquivo passa por uma verificação técnica
          automática e depois por revisão humana antes de entrar no ar.
        </AppText>

        <Card>
          <Stack gap={spacing.md}>
            {arquivo ? (
              <View style={styles.previa}>
                <Image
                  source={{ uri: arquivo.uri }}
                  style={styles.imagem}
                  contentFit="contain"
                  accessibilityLabel="Prévia do criativo escolhido"
                />
              </View>
            ) : (
              <View style={[styles.previa, styles.vazia]}>
                <Icon name="image-outline" size={32} color={colors.textSoft} />
                <AppText variant="small" color={colors.textMuted}>
                  Nenhum arquivo escolhido
                </AppText>
              </View>
            )}

            <Button
              title={arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
              variant="outline"
              icon="folder-open-outline"
              onPress={escolher}
              disabled={ocupado}
            />

            {arquivo ? (
              <AppText variant="small" numberOfLines={2}>
                {nomeDe(arquivo, tipoDe(arquivo))}
                {arquivo.fileSize ? ` — ${(arquivo.fileSize / 1_048_576).toFixed(1)} MB` : ''}
              </AppText>
            ) : null}
          </Stack>
        </Card>

        {ocupado || passo === 'pronto' ? (
          <Card
            style={{
              backgroundColor: passo === 'pronto' ? colors.successSoft : colors.blueSoft,
              borderColor: 'transparent',
            }}
          >
            <Row gap={spacing.sm}>
              <Icon
                name={passo === 'pronto' ? 'checkmark-circle' : 'time-outline'}
                size={18}
                color={passo === 'pronto' ? colors.success : colors.blue}
              />
              <AppText
                variant="small"
                color={passo === 'pronto' ? colors.success : colors.blue}
                style={{ flex: 1 }}
              >
                {rotulos[passo]}
              </AppText>
            </Row>
          </Card>
        ) : null}

        {erro ? (
          <Card style={{ backgroundColor: colors.dangerSoft, borderColor: 'transparent' }}>
            <Row gap={spacing.sm}>
              <Icon name="alert-circle" size={18} color={colors.danger} />
              <AppText
                variant="small"
                color={colors.danger}
                style={{ flex: 1 }}
                accessibilityLiveRegion="polite"
              >
                {erro}
              </AppText>
            </Row>
          </Card>
        ) : null}
      </Stack>
    </Screen>
  );
}

/**
 * Tipo MIME do que o seletor devolveu.
 *
 * `asset.mimeType` é opcional no Android em alguns provedores de conteúdo. O fallback olha o
 * `type` ('image' | 'video') e a extensão, nessa ordem — enviar `contentType` errado faz a API
 * recusar com `UNSUPPORTED_MEDIA_TYPE` por um motivo que não é o do usuário.
 */
function tipoDe(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType.toLowerCase();
  const ext = (asset.uri.split('.').pop() ?? '').toLowerCase();
  if (asset.type === 'video') return 'video/mp4';
  if (ext === 'png') return 'image/png';
  return 'image/jpeg';
}

function nomeDe(asset: ImagePicker.ImagePickerAsset, tipo: string): string {
  if (asset.fileName) return asset.fileName;
  const ext = tipo === 'video/mp4' ? 'mp4' : tipo === 'image/png' ? 'png' : 'jpg';
  return `criativo-${Date.now()}.${ext}`;
}

const styles = StyleSheet.create({
  previa: {
    height: 200,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  vazia: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  imagem: { width: '100%', height: '100%' },
});
