/**
 * Especificação do criativo e validação local, antes de gastar upload.
 *
 * Os números espelham o que a API recusa de fato, lidos na fonte e não supostos:
 *
 *  - `maxWidth: 1920`, `maxHeight: 1080`, `maxDurationSeconds: 120`,
 *    `maxVideoBytes: 524_288_000` — `platform-config.service.ts`, bloco `mediaLimits`.
 *  - duração mínima de 10 s e bitrate de 10 Mbps — `video-validator.service.ts`
 *    (`VIDEO_MIN_DURATION_SEC`, `VIDEO_MAX_BITRATE_BPS`), fixos no contrato da API.
 *  - tipos aceitos — `DEFAULT_ALLOWED_MIME` em `upload-session.service.ts`.
 *
 * **A proporção 16:9 é regra deste app, não do servidor.** O servidor só checa
 * `largura <= 1920 && altura <= 1080`, então uma peça 1920×600 passaria por ele. Ela não
 * serve: o anúncio é exibido em tablet 16:9 dentro do veículo, e qualquer outra proporção
 * aparece com tarja ou cortada sem o anunciante ter escolhido onde. Exigir aqui é o que
 * permite avisar e corrigir antes do envio, em vez de recusar depois.
 *
 * O servidor continua sendo a autoridade: se ele discordar, a tela mostra a mensagem dele.
 */

export const ESPEC = {
  larguraMax: 1920,
  alturaMax: 1080,
  /** 16:9 em paisagem. */
  proporcao: 16 / 9,
  /**
   * 1% de folga. Encoder de celular arredonda dimensão para múltiplo de 2 ou 16, e um
   * 1918×1080 (1,7759) é 16:9 na prática — recusar por isso seria pedantismo que o usuário
   * não tem como corrigir.
   */
  toleranciaProporcao: 0.01,
  duracaoMinSeg: 10,
  duracaoMaxSeg: 120,
  bytesMax: 524_288_000,
  tiposAceitos: ['video/mp4', 'image/jpeg', 'image/png'] as const,
} as const;

export type MotivoRecusa =
  | 'tipo'
  | 'tamanho'
  | 'dimensao_desconhecida'
  | 'proporcao'
  | 'dimensao'
  | 'duracao';

export interface Candidato {
  tipo: string;
  largura: number;
  altura: number;
  /** Segundos. Ausente para imagem. */
  duracaoSeg?: number | null;
  bytes?: number | null;
}

export type Veredito =
  | { ok: true; aviso?: string }
  | { ok: false; motivo: MotivoRecusa; mensagem: string; ajustavel: boolean };

const ehVideo = (tipo: string) => tipo.startsWith('video/');

/** Proporção, sempre em paisagem, para comparar com 16:9 sem depender da orientação. */
export function proporcaoDe(largura: number, altura: number): number {
  if (largura <= 0 || altura <= 0) return 0;
  return largura / altura;
}

export function eh16x9(largura: number, altura: number): boolean {
  const p = proporcaoDe(largura, altura);
  if (p <= 0) return false;
  return Math.abs(p - ESPEC.proporcao) / ESPEC.proporcao <= ESPEC.toleranciaProporcao;
}

function formatarProporcao(largura: number, altura: number): string {
  const p = proporcaoDe(largura, altura);
  if (p <= 0) return 'desconhecida';
  // Rótulo útil para os casos comuns de celular, em vez de um decimal cru.
  const conhecidas: [string, number][] = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['1:1', 1],
    ['19.5:9', 19.5 / 9],
    ['9:19.5', 9 / 19.5],
  ];
  for (const [rotulo, valor] of conhecidas) {
    if (Math.abs(p - valor) / valor <= 0.02) return rotulo;
  }
  return p >= 1 ? `${p.toFixed(2)}:1` : `1:${(1 / p).toFixed(2)}`;
}

/**
 * Decide se o arquivo escolhido serve, e se dá para consertar sem o usuário voltar à galeria.
 *
 * `ajustavel` vale só para imagem: recortar e redimensionar imagem é operação local e barata.
 * Vídeo exigiria recodificar, o que o app não faz — então para vídeo a resposta é explicar o
 * que precisa mudar, com o número que falhou, e não prometer um ajuste que não existe.
 */
export function validarCriativo(c: Candidato): Veredito {
  if (!(ESPEC.tiposAceitos as readonly string[]).includes(c.tipo)) {
    return {
      ok: false,
      motivo: 'tipo',
      mensagem: `Formato não aceito (${c.tipo}). Use vídeo MP4, ou imagem JPEG ou PNG.`,
      ajustavel: false,
    };
  }

  if (c.bytes != null && c.bytes > ESPEC.bytesMax) {
    const mb = (ESPEC.bytesMax / 1_048_576).toFixed(0);
    return {
      ok: false,
      motivo: 'tamanho',
      mensagem: `Arquivo acima do limite de ${mb} MB.`,
      ajustavel: false,
    };
  }

  if (c.largura <= 0 || c.altura <= 0) {
    return {
      ok: false,
      motivo: 'dimensao_desconhecida',
      mensagem:
        'Não foi possível ler as dimensões deste arquivo. Escolha outro, de preferência exportado em 1920×1080.',
      ajustavel: false,
    };
  }

  const video = ehVideo(c.tipo);

  if (!eh16x9(c.largura, c.altura)) {
    const atual = formatarProporcao(c.largura, c.altura);
    return {
      ok: false,
      motivo: 'proporcao',
      mensagem: video
        ? `Este vídeo é ${c.largura}×${c.altura} (${atual}). A tela do veículo é 16:9 em paisagem, então o vídeo precisa ser exportado em 16:9 — o ideal é 1920×1080.`
        : `Esta imagem é ${c.largura}×${c.altura} (${atual}). A tela do veículo é 16:9 em paisagem.`,
      ajustavel: !video,
    };
  }

  if (c.largura > ESPEC.larguraMax || c.altura > ESPEC.alturaMax) {
    return {
      ok: false,
      motivo: 'dimensao',
      mensagem: video
        ? `Este vídeo é ${c.largura}×${c.altura}, acima do limite de ${ESPEC.larguraMax}×${ESPEC.alturaMax}. Exporte em 1920×1080.`
        : `Esta imagem é ${c.largura}×${c.altura}, acima do limite de ${ESPEC.larguraMax}×${ESPEC.alturaMax}.`,
      ajustavel: !video,
    };
  }

  if (video) {
    const d = c.duracaoSeg ?? 0;
    if (!Number.isFinite(d) || d <= 0) {
      return {
        ok: false,
        motivo: 'duracao',
        mensagem: 'Não foi possível ler a duração deste vídeo. Escolha outro arquivo.',
        ajustavel: false,
      };
    }
    if (d < ESPEC.duracaoMinSeg || d > ESPEC.duracaoMaxSeg) {
      return {
        ok: false,
        motivo: 'duracao',
        mensagem: `O vídeo tem ${d.toFixed(0)} s. A duração aceita vai de ${ESPEC.duracaoMinSeg} s a ${ESPEC.duracaoMaxSeg} s.`,
        ajustavel: false,
      };
    }
  }

  // Passa, mas vale avisar: peça pequena esticada num tablet fica visivelmente borrada.
  if (c.largura < ESPEC.larguraMax / 2) {
    return {
      ok: true,
      aviso: `Resolução baixa (${c.largura}×${c.altura}). Vai ser ampliada na tela do veículo e pode ficar borrada. O ideal é ${ESPEC.larguraMax}×${ESPEC.alturaMax}.`,
    };
  }

  return { ok: true };
}

export interface Recorte {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Maior retângulo 16:9 centralizado que cabe na imagem de origem.
 *
 * Centralizado porque é a escolha menos pior sem perguntar: numa peça publicitária o
 * assunto quase sempre está no meio. A tela avisa o que vai ser cortado, e quem não aceitar
 * o corte exporta em 16:9 e envia de novo.
 */
export function recorteCentral16x9(largura: number, altura: number): Recorte {
  const proporcaoOrigem = largura / altura;
  if (proporcaoOrigem > ESPEC.proporcao) {
    // Origem mais larga que 16:9: sobra largura, corta nas laterais.
    const width = Math.round(altura * ESPEC.proporcao);
    const usado = Math.min(width, largura);
    return {
      originX: Math.max(0, Math.round((largura - usado) / 2)),
      originY: 0,
      width: usado,
      height: altura,
    };
  }
  // Origem mais alta que 16:9: sobra altura, corta em cima e embaixo.
  const height = Math.round(largura / ESPEC.proporcao);
  const usado = Math.min(height, altura);
  return {
    originX: 0,
    originY: Math.max(0, Math.round((altura - usado) / 2)),
    width: largura,
    height: usado,
  };
}

/**
 * Dimensão final depois do recorte: reduz para caber em 1920×1080, nunca amplia.
 *
 * Ampliar não acrescenta informação e só engorda o arquivo; o servidor aceita qualquer coisa
 * dentro do teto, então uma peça 1280×720 sobe como está.
 */
export function destinoAposRecorte(recorte: Recorte): { width: number; height: number } | null {
  if (recorte.width <= ESPEC.larguraMax && recorte.height <= ESPEC.alturaMax) return null;
  return { width: ESPEC.larguraMax, height: ESPEC.alturaMax };
}

/** Quanto da imagem original se perde no recorte, em porcentagem de área. */
export function perdaDoRecorte(largura: number, altura: number, recorte: Recorte): number {
  const areaOrigem = largura * altura;
  if (areaOrigem <= 0) return 0;
  const areaFinal = recorte.width * recorte.height;
  return Math.max(0, Math.round((1 - areaFinal / areaOrigem) * 100));
}
