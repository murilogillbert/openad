/**
 * Preço de uma veiculação: quantos segundos ela custa, e quanto isso dá em dinheiro.
 *
 * Funções puras, fora de serviço injetável, pelo mesmo motivo de
 * `internal/driver-payout.policy.ts`: a mesma aritmética é consultada no faturamento, no
 * relatório do anunciante, na estimativa de inventário e na criação de campanha. Quatro cópias
 * acabariam em quatro resultados, e o que divergiria é dinheiro.
 *
 * ============================================================================
 * Por que micro-real
 * ============================================================================
 *
 * O preço acordado é R$ 0,003 por segundo de tela. Isso é 0,3 centavo, e **não cabe em centavo
 * inteiro** — que é a unidade em que todo o resto do sistema conta. Uma imagem de 15 s custa
 * 4,5 centavos; um vídeo de 10 s, 3 centavos; de 120 s, 36 centavos.
 *
 * Arredondar por veiculação perderia 0,5 centavo dos 4,5 de uma imagem (11%), sempre contra o
 * mesmo lado, multiplicado por milhões de veiculações. Então o custo é calculado e acumulado
 * em **micro-reais** (1 R$ = 1.000.000 µR$), que é inteiro e não tem fração escondida:
 *
 *     R$ 0,003/s = 3.000 µR$/s
 *     imagem de 15 s = 45.000 µR$ = 4,5 centavos
 *
 * A conversão para centavos acontece só na fronteira do lançamento contábil, com o resto
 * menor que um centavo carregado para o lançamento seguinte. Assim o viés nunca acumula.
 *
 * ============================================================================
 * Compatibilidade
 * ============================================================================
 *
 * As campanhas que já existem são `per_impression`: uma tarifa fixa por veiculação, em
 * centavos, que o anunciante digitava. Elas continuam assim. Só campanha nova nasce
 * `per_second`, e com o preço **gravado nela** na criação — para um reajuste futuro não
 * reprecificar campanha que já está no ar.
 *
 * O app do anunciante já publicado continua enviando `ratePerImpressionCents`, e a API só pode
 * mudar de forma aditiva. Por isso o modelo de preço é um campo novo com padrão, e não uma
 * troca.
 */

/** 1 real = 1.000.000 micro-reais. */
export const MICROS_POR_REAL = 1_000_000;
/** 1 centavo = 10.000 micro-reais. */
export const MICROS_POR_CENTAVO = 10_000;

export type ModeloDePreco = 'per_impression' | 'per_second';

export interface PrecoDaCampanha {
  modelo: ModeloDePreco;
  /** Preço por segundo gravado na campanha, em µR$. Nulo em campanha `per_impression`. */
  pricePerSecondMicros: number | null;
  /** Tarifa por veiculação, em centavos. É o que as campanhas antigas usam. */
  ratePerImpressionCents: number;
}

/** O que se sabe do criativo no momento de precificar. */
export interface CriativoParaPrecificar {
  /** `image` cobra `imageDisplaySeconds`; `video` cobra a própria duração. */
  kind: 'image' | 'video';
  /** Duração do vídeo em segundos, do ffprobe (fracionária). Ignorada em imagem. */
  durationSec: number | null;
}

/**
 * Imagem ou vídeo, derivado do que já está gravado no asset.
 *
 * **Deliberadamente não é um campo novo no schema.** Um campo exigiria preencher o acervo
 * existente, e um backfill que errasse mudaria o preço de campanha no ar. O `mimeType` é
 * gravado na criação do asset e a extensão do arquivo sempre existe, então a derivação cobre
 * o acervo inteiro sem migração — é o mesmo caminho que `tipoDeConteudo` já usa no manifesto.
 *
 * O padrão é `video`, e não `image`, porque ele é o conservador aqui: vídeo cobra a duração
 * medida, enquanto imagem cobra 15 s fixos. Um asset mal classificado como imagem cobraria 15
 * s de algo que pode ter tocado 3; classificado como vídeo, cobra o que de fato tocou.
 */
export function tipoDoCriativo(asset: {
  mimeType?: string | null;
  filename?: string | null;
}): 'image' | 'video' {
  const mime = asset.mimeType?.trim().toLowerCase();
  if (mime) {
    return mime.startsWith('image/') ? 'image' : 'video';
  }
  const ext = asset.filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const extensoesDeImagem = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
  return ext && extensoesDeImagem.has(ext) ? 'image' : 'video';
}

/**
 * Segundos que uma veiculação cobra.
 *
 * Imagem: `imageDisplaySeconds` da configuração, **não** o `duration` gravado no asset. As
 * imagens enviadas antes desta regra têm `duration: 10` gravado, e cobrar 10 s de uma imagem
 * que fica 15 s na tela seria cobrar menos do que o combinado, em silêncio.
 *
 * Vídeo: `floor` da duração. O ffprobe devolve fracionário (ex.: 30,04 s), e cobrar o
 * fracionário arredondado para cima cobraria um segundo que não existiu. Para baixo, a
 * diferença é de menos de um segundo e fica com o anunciante — o lado certo, porque o número
 * é medido e não declarado.
 *
 * Devolve 0 quando não há duração conhecida de vídeo: veiculação sem duração não é cobrada por
 * tempo. É o caso de asset antigo sem `duration`, e cobrar um palpite ali seria pior.
 */
export function segundosCobrados(
  criativo: CriativoParaPrecificar,
  imageDisplaySeconds: number
): number {
  if (criativo.kind === 'image') {
    return Math.max(0, Math.floor(imageDisplaySeconds));
  }
  if (criativo.durationSec === null || !Number.isFinite(criativo.durationSec)) {
    return 0;
  }
  return Math.max(0, Math.floor(criativo.durationSec));
}

/**
 * Custo de uma veiculação em micro-reais.
 *
 * Em `per_second`, `preço por segundo × segundos`. Em `per_impression`, a tarifa fixa da
 * campanha convertida para µR$ — o que mantém campanha antiga e nova somáveis no mesmo
 * acumulador, que é o que permite o relatório não ter dois caminhos.
 *
 * Campanha `per_second` sem preço gravado cai no preço da plataforma. Não deveria acontecer
 * (a criação grava), mas devolver zero aqui faria uma campanha veicular de graça sem nada
 * indicar — e zero é indistinguível de inventário institucional, que é legítimo.
 */
export function custoEmMicros(params: {
  preco: PrecoDaCampanha;
  segundos: number;
  /** Preço da plataforma, usado só quando a campanha `per_second` não tem preço próprio. */
  pricePerSecondMicrosPadrao: number;
}): number {
  const { preco, segundos, pricePerSecondMicrosPadrao } = params;

  if (preco.modelo === 'per_impression') {
    return Math.max(0, Math.floor(preco.ratePerImpressionCents)) * MICROS_POR_CENTAVO;
  }

  const porSegundo = preco.pricePerSecondMicros ?? pricePerSecondMicrosPadrao;
  if (!Number.isFinite(porSegundo) || porSegundo <= 0 || segundos <= 0) {
    return 0;
  }
  return Math.floor(porSegundo) * Math.max(0, Math.floor(segundos));
}

export interface ConversaoParaCentavos {
  /** Centavos inteiros a lançar agora. */
  centavos: number;
  /** Resto em µR$, menor que um centavo, a carregar para o próximo lançamento. */
  restoMicros: number;
}

/**
 * Converte micro-reais acumulados em centavos inteiros, **arredondando para baixo**, e devolve
 * o resto para ser carregado.
 *
 * O arredondamento para baixo foi decidido com o dono do produto. O que não é óbvio é *onde*
 * ele se aplica: por veiculação, uma imagem de 15 s (4,5 centavos) perderia 0,5 centavo —
 * 11%, sempre contra o anunciante ou sempre contra o motorista, dependendo do lado. Aplicado
 * sobre o acumulado, com o resto carregado para o lançamento seguinte, o viés não acumula: o
 * meio centavo de hoje entra no total de amanhã.
 *
 * `restoMicros` **precisa ser persistido** por quem chama, senão o carregamento não acontece e
 * o arredondamento volta a ser por lote. É por isso que a função devolve o resto em vez de
 * descartá-lo.
 */
export function microsParaCentavos(
  micros: number,
  restoAnteriorMicros = 0
): ConversaoParaCentavos {
  const total = Math.max(0, Math.floor(micros) + Math.floor(restoAnteriorMicros));
  const centavos = Math.floor(total / MICROS_POR_CENTAVO);
  return { centavos, restoMicros: total - centavos * MICROS_POR_CENTAVO };
}

/** Micro-reais formatados em reais, para texto de interface e de relatório. */
export function microsParaReais(micros: number): number {
  return Math.floor(micros) / MICROS_POR_REAL;
}

export interface LinhaDaTabelaDePreco {
  segundos: number;
  custoMicros: number;
  custoReais: number;
}

/**
 * Tabela de preço por duração, para a tela do anunciante.
 *
 * Existe aqui, e não na tela, porque o anunciante precisa ver o **mesmo** número que será
 * cobrado. Tabela montada no cliente divergiria do servidor no primeiro reajuste.
 *
 * A R$ 0,003/s: imagem 15 s = R$ 0,045; vídeo 10 s = R$ 0,03; 30 s = R$ 0,09; 60 s = R$ 0,18;
 * 120 s = R$ 0,36. Os pacotes acordados fecham exatamente nisso — 15 s × 20 mil = R$ 900,
 * 30 s × 30 mil = R$ 2.700, 60 s × 50 mil = R$ 9.000.
 */
export function tabelaDePreco(
  pricePerSecondMicros: number,
  duracoes: number[] = [10, 15, 30, 60, 120]
): LinhaDaTabelaDePreco[] {
  return duracoes.map((segundos) => {
    const custoMicros = Math.floor(pricePerSecondMicros) * Math.floor(segundos);
    return { segundos, custoMicros, custoReais: microsParaReais(custoMicros) };
  });
}

/**
 * Quantas veiculações de `segundos` um saldo cobre.
 *
 * `floor`, porque veiculação parcial não existe: o anunciante vê quantas exibições inteiras o
 * crédito paga, e não um número com casas decimais que ele teria de interpretar.
 */
export function veiculacoesQueOSaldoCobre(params: {
  saldoMicros: number;
  pricePerSecondMicros: number;
  segundos: number;
}): number {
  const custo = Math.floor(params.pricePerSecondMicros) * Math.floor(params.segundos);
  if (custo <= 0) {
    return 0;
  }
  return Math.floor(Math.max(0, params.saldoMicros) / custo);
}
