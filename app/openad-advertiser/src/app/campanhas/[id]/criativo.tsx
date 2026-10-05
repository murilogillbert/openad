import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { criativo as apiCriativo } from '@/api/endpoints';
import { chaves } from '@/api/queryKeys';
import { errorDetail, errorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText, Card, Divider, Icon, Row, Stack } from '@/components/ui/primitives';
import {
  destinoAposRecorte,
  ESPEC,
  perdaDoRecorte,
  recorteCentral16x9,
  validarCriativo,
  type Veredito,
} from '@/lib/criativo';
import { colors, radius, spacing } from '@/theme/tokens';

type Passo = 'escolher' | 'ajustando' | 'abrindo' | 'enviando' | 'validando' | 'pronto';

const rotulos: Record<Passo, string> = {
  escolher: '',
  ajustando: 'Ajustando a imagem…',
  abrindo: 'Abrindo a sessão de envio…',
  enviando: 'Enviando o arquivo…',
  validando: 'Verificando o arquivo…',
  pronto: 'Criativo aprovado.',
};

/** O que o anunciante precisa saber **antes** de abrir a galeria. */
function Requisitos() {
  const linhas = [
    `Proporção 16:9 em paisagem, no máximo ${ESPEC.larguraMax}×${ESPEC.alturaMax}`,
    'Imagem JPEG ou PNG, ou vídeo MP4 (H.264 ou H.265)',
    `Vídeo de ${ESPEC.duracaoMinSeg} s a ${ESPEC.duracaoMaxSeg} s`,
  ];
  return (
    <Card style={{ backgroundColor: colors.blueSoft, borderColor: 'transparent' }}>
      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm}>
          <Icon name="information-circle" size={18} color={colors.blue} />
          <AppText variant="label" color={colors.blue} style={{ flex: 1 }}>
            O que a tela do veículo aceita
          </AppText>
        </Row>
        {linhas.map((l) => (
          <Row key={l} gap={spacing.sm}>
            <AppText variant="small" color={colors.blue}>
              •
            </AppText>
            <AppText variant="small" color={colors.blue} style={{ flex: 1 }}>
              {l}
            </AppText>
          </Row>
        ))}
        <Divider />
        <AppText variant="small" color={colors.blue}>
          Foto de celular costuma ser vertical e não serve. Se você escolher uma imagem fora
          do 16:9, o app oferece o ajuste automático e mostra o que vai ser cortado.
        </AppText>
      </Stack>
    </Card>
  );
}

export default function Criativo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [arquivo, setArquivo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [passo, setPasso] = useState<Passo>('escolher');
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Informação de suporte: em qual dos três passos parou, e a causa técnica.
   *
   * O envio tem três chamadas e a mensagem amigável é a mesma para todas, então sem isto o
   * usuário não tem como dizer o que falhou — e quem atende não tem como saber se foi abrir
   * a sessão, subir os bytes ou a validação do arquivo.
   */
  const [detalhe, setDetalhe] = useState<string | null>(null);
  /** Fração enviada (0 a 1) durante o passo de bytes. Vídeo de 90 MB sem isso parece travado. */
  const [progresso, setProgresso] = useState<number | null>(null);
  /** Resultado da validação local do arquivo escolhido. */
  const [veredito, setVeredito] = useState<Veredito | null>(null);
  /** Texto do que o ajuste automático fez, quando houve ajuste. */
  const [ajuste, setAjuste] = useState<string | null>(null);

  const ocupado =
    passo === 'ajustando' || passo === 'abrindo' || passo === 'enviando' || passo === 'validando';
  const podeEnviar = !!arquivo && veredito?.ok === true && !ocupado;

  function avaliar(asset: ImagePicker.ImagePickerAsset) {
    const tipo = tipoDe(asset);
    return validarCriativo({
      tipo,
      largura: asset.width,
      altura: asset.height,
      // O seletor devolve duração em **milissegundos**; a especificação é em segundos.
      duracaoSeg: asset.duration != null ? asset.duration / 1000 : null,
      bytes: asset.fileSize ?? null,
    });
  }

  async function escolher() {
    setErro(null);
    setDetalhe(null);
    setAjuste(null);
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      setErro('Precisamos de acesso às suas fotos e vídeos para enviar o criativo.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      /**
       * Sem o recortador nativo de propósito.
       *
       * Ele devolveria 16:9 se recebesse `aspect`, mas não limita a dimensão: recortar uma
       * foto de 4000×3000 dá 4000×2250, que continua acima de 1920×1080 e o servidor recusa.
       * O ajuste aqui é feito depois, com recorte **e** redução, e mostrando ao usuário o
       * que foi cortado.
       */
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    if (r.canceled || !r.assets[0]) return;

    const asset = r.assets[0];
    setArquivo(asset);
    setPasso('escolher');
    const v = avaliar(asset);
    setVeredito(v);
    setErro(v.ok ? null : v.mensagem);
  }

  /**
   * Recorta para 16:9 no centro e reduz para caber em 1920×1080.
   *
   * Só para imagem. Vídeo exigiria recodificar, o que o app não faz — e oferecer um botão
   * que não entrega seria pior que a recusa honesta.
   */
  async function ajustar() {
    if (!arquivo) return;
    setErro(null);
    setDetalhe(null);
    try {
      setPasso('ajustando');
      const recorte = recorteCentral16x9(arquivo.width, arquivo.height);
      const destino = destinoAposRecorte(recorte);
      const perda = perdaDoRecorte(arquivo.width, arquivo.height, recorte);

      const contexto = ImageManipulator.manipulate(arquivo.uri);
      contexto.crop(recorte);
      if (destino) contexto.resize(destino);
      const referencia = await contexto.renderAsync();
      const salvo = await referencia.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });

      const ajustado: ImagePicker.ImagePickerAsset = {
        ...arquivo,
        uri: salvo.uri,
        width: salvo.width,
        height: salvo.height,
        mimeType: 'image/jpeg',
        // O arquivo é outro: nome e tamanho antigos deixariam de valer.
        fileName: `criativo-16x9-${Date.now()}.jpg`,
        fileSize: undefined,
      };

      setArquivo(ajustado);
      setAjuste(
        `Ajustado de ${arquivo.width}×${arquivo.height} para ${salvo.width}×${salvo.height}. ` +
          `Cerca de ${perda}% da imagem foi cortado nas bordas para caber em 16:9.`
      );
      const v = avaliar(ajustado);
      setVeredito(v);
      setErro(v.ok ? null : v.mensagem);
      setPasso('escolher');
    } catch (err) {
      setErro(`Não foi possível ajustar a imagem. ${errorMessage(err, '')}`.trim());
      setPasso('escolher');
    }
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
    // Rede de segurança: o botão já fica desabilitado, mas um arquivo recusado nunca deve
    // consumir sessão de upload nem banda do anunciante.
    if (veredito?.ok !== true) {
      setErro(veredito?.ok === false ? veredito.mensagem : 'Escolha um arquivo antes de enviar.');
      return;
    }
    setErro(null);
    setDetalhe(null);
    setProgresso(null);
    const tipo = tipoDe(arquivo);
    const nome = nomeDe(arquivo, tipo);
    // Guardado fora do `try` para o catch saber em qual passo parou.
    let onde: Passo = 'abrindo';

    try {
      setPasso('abrindo');
      const sessao = await apiCriativo.abrirSessao(id, nome, tipo);
      const sessionId = sessao.data.sessionId;

      onde = 'enviando';
      setPasso('enviando');
      setProgresso(0);
      /**
       * O arquivo vai como `{ uri, name, type }` para o enviador por XHR, que faz o
       * streaming nativo. Montar `FormData` aqui e passar para o `fetch` do Expo era o que
       * lançava `Unsupported FormDataPart implementation` em todo envio.
       */
      await apiCriativo.enviarBytes(id, sessionId, { uri: arquivo.uri, name: nome, type: tipo }, setProgresso);

      onde = 'validando';
      setPasso('validando');
      setProgresso(null);
      await apiCriativo.concluir(id, sessionId);

      setPasso('pronto');
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.todas });
      queryClient.invalidateQueries({ queryKey: chaves.campanhas.detalhe(id) });
    } catch (err) {
      setErro(errorMessage(err));
      const causa = errorDetail(err);
      const passoLegivel =
        onde === 'abrindo' ? 'abrir sessão' : onde === 'enviando' ? 'enviar bytes' : 'validar';
      setDetalhe(
        [
          `passo: ${passoLegivel}`,
          `arquivo: ${nome} · ${tipo}`,
          arquivo.fileSize ? `tamanho: ${(arquivo.fileSize / 1_048_576).toFixed(1)} MB` : null,
          `origem: ${arquivo.uri.split('?')[0]?.slice(0, 70) ?? arquivo.uri.slice(0, 70)}`,
          causa ? `causa: ${causa}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
      setProgresso(null);
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
            disabled={!podeEnviar}
            accessibilityHint={
              arquivo && veredito?.ok === false
                ? 'Indisponível: o arquivo escolhido não atende ao formato da tela do veículo.'
                : undefined
            }
            onPress={enviar}
          />
        )
      }
    >
      <Stack gap={spacing.lg}>
        <AppText variant="title">Criativo do anúncio</AppText>
        <AppText variant="small">
          O arquivo passa por uma verificação técnica automática e depois por revisão humana
          antes de entrar no ar.
        </AppText>

        <Requisitos />

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
              <Stack gap={4}>
                <AppText variant="small" numberOfLines={2}>
                  {nomeDe(arquivo, tipoDe(arquivo))}
                  {arquivo.fileSize ? ` — ${(arquivo.fileSize / 1_048_576).toFixed(1)} MB` : ''}
                </AppText>
                {arquivo.width > 0 && arquivo.height > 0 ? (
                  <Row gap={spacing.sm}>
                    <Icon
                      name={veredito?.ok ? 'checkmark-circle' : 'alert-circle'}
                      size={14}
                      color={veredito?.ok ? colors.success : colors.danger}
                    />
                    <AppText
                      variant="small"
                      color={veredito?.ok ? colors.success : colors.danger}
                    >
                      {arquivo.width}×{arquivo.height}
                      {arquivo.duration != null
                        ? ` · ${(arquivo.duration / 1000).toFixed(0)} s`
                        : ''}
                    </AppText>
                  </Row>
                ) : null}
              </Stack>
            ) : null}

            {/* O ajuste é oferecido só quando ele realmente resolve: imagem fora do 16:9
                ou acima do limite. Para vídeo o veredito traz `ajustavel: false`. */}
            {arquivo && veredito?.ok === false && veredito.ajustavel ? (
              <Button
                title={`Ajustar para 16:9 (${ESPEC.larguraMax}×${ESPEC.alturaMax})`}
                variant="secondary"
                icon="crop-outline"
                loading={passo === 'ajustando'}
                disabled={ocupado}
                onPress={ajustar}
                accessibilityHint="Recorta a imagem no centro e reduz para o tamanho da tela do veículo."
              />
            ) : null}
          </Stack>
        </Card>

        {ajuste ? (
          <Card style={{ backgroundColor: colors.blueSoft, borderColor: 'transparent' }}>
            <Row gap={spacing.sm}>
              <Icon name="crop-outline" size={18} color={colors.blue} />
              <AppText
                variant="small"
                color={colors.blue}
                style={{ flex: 1 }}
                accessibilityLiveRegion="polite"
              >
                {ajuste}
              </AppText>
            </Row>
          </Card>
        ) : null}

        {veredito?.ok && veredito.aviso ? (
          <Card style={{ backgroundColor: colors.surfaceAlt, borderColor: 'transparent' }}>
            <Row gap={spacing.sm}>
              <Icon name="alert-circle-outline" size={18} color={colors.textMuted} />
              <AppText variant="small" style={{ flex: 1 }}>
                {veredito.aviso}
              </AppText>
            </Row>
          </Card>
        ) : null}

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
                {passo === 'enviando' && progresso !== null
                  ? `${rotulos.enviando} ${Math.round(progresso * 100)}%`
                  : rotulos[passo]}
              </AppText>
            </Row>
          </Card>
        ) : null}

        {erro ? (
          <Card style={{ backgroundColor: colors.dangerSoft, borderColor: 'transparent' }}>
            <Stack gap={spacing.sm}>
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
              {detalhe ? (
                <AppText
                  variant="caption"
                  color={colors.danger}
                  style={{ textTransform: 'none' }}
                  selectable
                  accessibilityLabel={`Informação de suporte. ${detalhe}`}
                >
                  {detalhe}
                </AppText>
              ) : null}
            </Stack>
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
