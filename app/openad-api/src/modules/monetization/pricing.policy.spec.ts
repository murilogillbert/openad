import {
  custoEmMicros,
  microsParaCentavos,
  microsParaReais,
  MICROS_POR_CENTAVO,
  MICROS_POR_REAL,
  segundosCobrados,
  tabelaDePreco,
  tipoDoCriativo,
  veiculacoesQueOSaldoCobre,
  type PrecoDaCampanha,
} from './pricing.policy';

/**
 * Preço por segundo de tela.
 *
 * O valor acordado é R$ 0,003/s, que é 0,3 centavo — não cabe na unidade em que o resto do
 * sistema conta. Estes casos travam a aritmética que decide quanto o anunciante paga e quanto
 * o motorista recebe, e em particular travam **onde** o arredondamento acontece: por
 * veiculação, uma imagem de 15 s perderia 0,5 centavo dos 4,5 (11%), sempre contra o mesmo
 * lado.
 */

const PRECO_PADRAO = 3_000; // R$ 0,003/s
const IMAGEM_SEGUNDOS = 15;

describe('unidades', () => {
  it('um real tem um milhao de micro-reais e cem centavos', () => {
    expect(MICROS_POR_REAL).toBe(1_000_000);
    expect(MICROS_POR_CENTAVO).toBe(10_000);
    expect(MICROS_POR_REAL / MICROS_POR_CENTAVO).toBe(100);
  });

  it('o preco acordado de R$ 0,003 por segundo cabe exato em micro-reais', () => {
    // É a razão de a unidade existir: 0,3 centavo não é representável em centavo inteiro.
    expect(PRECO_PADRAO / MICROS_POR_REAL).toBe(0.003);
    expect(PRECO_PADRAO / MICROS_POR_CENTAVO).toBe(0.3);
  });
});

describe('segundosCobrados', () => {
  it('imagem cobra o valor da configuracao, nao a duracao gravada no asset', () => {
    /**
     * As imagens enviadas antes desta regra têm `duration: 10` gravado. Cobrar o asset cobraria
     * 10 s de uma imagem que fica 15 s na tela — menos do que o combinado, em silêncio.
     */
    expect(segundosCobrados({ kind: 'image', durationSec: 10 }, IMAGEM_SEGUNDOS)).toBe(15);
    expect(segundosCobrados({ kind: 'image', durationSec: null }, IMAGEM_SEGUNDOS)).toBe(15);
  });

  it('video cobra a propria duracao, arredondada para baixo', () => {
    // O ffprobe devolve fracionário; para cima cobraria um segundo que não existiu.
    expect(segundosCobrados({ kind: 'video', durationSec: 30 }, IMAGEM_SEGUNDOS)).toBe(30);
    expect(segundosCobrados({ kind: 'video', durationSec: 30.04 }, IMAGEM_SEGUNDOS)).toBe(30);
    expect(segundosCobrados({ kind: 'video', durationSec: 119.99 }, IMAGEM_SEGUNDOS)).toBe(119);
  });

  it('video sem duracao conhecida nao cobra por tempo', () => {
    // Asset antigo sem `duration`. Cobrar um palpite aqui seria pior que não cobrar.
    expect(segundosCobrados({ kind: 'video', durationSec: null }, IMAGEM_SEGUNDOS)).toBe(0);
    expect(segundosCobrados({ kind: 'video', durationSec: NaN }, IMAGEM_SEGUNDOS)).toBe(0);
  });
});

describe('custoEmMicros', () => {
  const porSegundo: PrecoDaCampanha = {
    modelo: 'per_second',
    pricePerSecondMicros: PRECO_PADRAO,
    ratePerImpressionCents: 0,
  };

  it('imagem de 15 s custa 4,5 centavos, sem perder a metade', () => {
    const micros = custoEmMicros({
      preco: porSegundo,
      segundos: 15,
      pricePerSecondMicrosPadrao: PRECO_PADRAO,
    });
    expect(micros).toBe(45_000);
    expect(micros / MICROS_POR_CENTAVO).toBe(4.5);
    expect(microsParaReais(micros)).toBe(0.045);
  });

  it('a tabela acordada fecha exatamente', () => {
    const custo = (s: number) =>
      microsParaReais(
        custoEmMicros({
          preco: porSegundo,
          segundos: s,
          pricePerSecondMicrosPadrao: PRECO_PADRAO,
        })
      );
    expect(custo(10)).toBe(0.03);
    expect(custo(15)).toBe(0.045);
    expect(custo(30)).toBe(0.09);
    expect(custo(60)).toBe(0.18);
    expect(custo(120)).toBe(0.36);
  });

  it('os pacotes acordados fecham nos valores do plano', () => {
    // 15 s x 20 mil = R$ 900; 30 s x 30 mil = R$ 2.700; 60 s x 50 mil = R$ 9.000.
    const pacote = (s: number, n: number) =>
      microsParaReais(
        custoEmMicros({
          preco: porSegundo,
          segundos: s,
          pricePerSecondMicrosPadrao: PRECO_PADRAO,
        }) * n
      );
    expect(pacote(15, 20_000)).toBe(900);
    expect(pacote(30, 30_000)).toBe(2_700);
    expect(pacote(60, 50_000)).toBe(9_000);
  });

  it('campanha antiga continua na tarifa fixa por veiculacao', () => {
    /**
     * Compatibilidade: as campanhas que existem são `per_impression`, e o app do anunciante
     * publicado continua enviando `ratePerImpressionCents`. Converter a tarifa para µR$ mantém
     * campanha antiga e nova somáveis no mesmo acumulador, que é o que permite o relatório não
     * ter dois caminhos.
     */
    const antiga: PrecoDaCampanha = {
      modelo: 'per_impression',
      pricePerSecondMicros: null,
      ratePerImpressionCents: 7,
    };
    const micros = custoEmMicros({
      preco: antiga,
      segundos: 999,
      pricePerSecondMicrosPadrao: PRECO_PADRAO,
    });
    // Os segundos são ignorados de propósito: o modelo antigo não cobra por tempo.
    expect(micros).toBe(70_000);
    expect(micros / MICROS_POR_CENTAVO).toBe(7);
  });

  it('tarifa zero custa zero, porque inventario institucional existe', () => {
    const institucional: PrecoDaCampanha = {
      modelo: 'per_impression',
      pricePerSecondMicros: null,
      ratePerImpressionCents: 0,
    };
    expect(
      custoEmMicros({
        preco: institucional,
        segundos: 15,
        pricePerSecondMicrosPadrao: PRECO_PADRAO,
      })
    ).toBe(0);
  });

  it('campanha por segundo sem preco gravado cai no preco da plataforma', () => {
    /**
     * Não deveria acontecer, porque a criação grava o preço. Devolver zero aqui faria a
     * campanha veicular de graça sem nada indicar — e zero é indistinguível de inventário
     * institucional, que é legítimo.
     */
    expect(
      custoEmMicros({
        preco: { modelo: 'per_second', pricePerSecondMicros: null, ratePerImpressionCents: 0 },
        segundos: 15,
        pricePerSecondMicrosPadrao: PRECO_PADRAO,
      })
    ).toBe(45_000);
  });

  it('zero segundos custa zero', () => {
    expect(
      custoEmMicros({ preco: porSegundo, segundos: 0, pricePerSecondMicrosPadrao: PRECO_PADRAO })
    ).toBe(0);
  });

  it('o preco gravado na campanha vence o da plataforma', () => {
    // É o que impede um reajuste futuro de reprecificar campanha que já está no ar.
    expect(
      custoEmMicros({
        preco: { modelo: 'per_second', pricePerSecondMicros: 1_000, ratePerImpressionCents: 0 },
        segundos: 15,
        pricePerSecondMicrosPadrao: PRECO_PADRAO,
      })
    ).toBe(15_000);
  });
});

describe('microsParaCentavos', () => {
  it('arredonda para baixo e devolve o resto', () => {
    const r = microsParaCentavos(45_000);
    expect(r.centavos).toBe(4);
    expect(r.restoMicros).toBe(5_000);
  });

  it('o resto carregado nao deixa o vies acumular', () => {
    /**
     * O caso que justifica a função devolver o resto em vez de descartá-lo.
     *
     * Duas imagens de 15 s custam 9 centavos exatos. Arredondando por veiculação, cada uma
     * lançaria 4 e o total seria 8 — um centavo perdido a cada duas exibições, sempre contra o
     * mesmo lado. Com o resto carregado, o total fecha em 9.
     */
    const primeira = microsParaCentavos(45_000, 0);
    const segunda = microsParaCentavos(45_000, primeira.restoMicros);
    expect(primeira.centavos + segunda.centavos).toBe(9);
    expect(segunda.restoMicros).toBe(0);
  });

  it('dez imagens de 15 s fecham em 45 centavos, sem perda', () => {
    let resto = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = microsParaCentavos(45_000, resto);
      total += r.centavos;
      resto = r.restoMicros;
    }
    expect(total).toBe(45);
    expect(resto).toBe(0);
  });

  it('valor menor que um centavo nao lanca nada e fica inteiro no resto', () => {
    const r = microsParaCentavos(3_000);
    expect(r.centavos).toBe(0);
    expect(r.restoMicros).toBe(3_000);
  });

  it('nao produz centavo negativo', () => {
    const r = microsParaCentavos(-5_000);
    expect(r.centavos).toBe(0);
    expect(r.restoMicros).toBe(0);
  });
});

describe('tabelaDePreco', () => {
  it('monta a tabela que o anunciante ve, com os mesmos numeros que serao cobrados', () => {
    // Existe no servidor, e não na tela, porque tabela montada no cliente divergiria do
    // servidor no primeiro reajuste.
    const t = tabelaDePreco(PRECO_PADRAO, [15, 30]);
    expect(t).toEqual([
      { segundos: 15, custoMicros: 45_000, custoReais: 0.045 },
      { segundos: 30, custoMicros: 90_000, custoReais: 0.09 },
    ]);
  });
});

describe('veiculacoesQueOSaldoCobre', () => {
  it('R$ 900 cobrem 20 mil exibicoes de 15 s', () => {
    expect(
      veiculacoesQueOSaldoCobre({
        saldoMicros: 900 * MICROS_POR_REAL,
        pricePerSecondMicros: PRECO_PADRAO,
        segundos: 15,
      })
    ).toBe(20_000);
  });

  it('arredonda para baixo, porque veiculacao parcial nao existe', () => {
    expect(
      veiculacoesQueOSaldoCobre({
        saldoMicros: 44_999,
        pricePerSecondMicros: PRECO_PADRAO,
        segundos: 15,
      })
    ).toBe(0);
  });

  it('preco zero nao cobre infinitas exibicoes', () => {
    // A divisão por zero daria `Infinity`, que vazaria para a tela como número de exibições.
    expect(
      veiculacoesQueOSaldoCobre({ saldoMicros: 1_000_000, pricePerSecondMicros: 0, segundos: 15 })
    ).toBe(0);
  });

  it('saldo negativo cobre zero', () => {
    expect(
      veiculacoesQueOSaldoCobre({
        saldoMicros: -100,
        pricePerSecondMicros: PRECO_PADRAO,
        segundos: 15,
      })
    ).toBe(0);
  });
});

describe('tipoDoCriativo', () => {
  /**
   * Derivado do que já está gravado, de propósito: um campo novo no schema exigiria preencher
   * o acervo existente, e um backfill que errasse mudaria o preço de campanha no ar.
   */
  it('usa o mimeType quando existe', () => {
    expect(tipoDoCriativo({ mimeType: 'image/png' })).toBe('image');
    expect(tipoDoCriativo({ mimeType: 'image/webp' })).toBe('image');
    expect(tipoDoCriativo({ mimeType: 'video/mp4' })).toBe('video');
  });

  it('cai na extensao do arquivo quando o mimeType falta', () => {
    expect(tipoDoCriativo({ filename: 'banner.PNG' })).toBe('image');
    expect(tipoDoCriativo({ filename: 'promo.jpeg' })).toBe('image');
    expect(tipoDoCriativo({ filename: 'filme.mp4' })).toBe('video');
  });

  it('o mimeType vence a extensao', () => {
    // Arquivo renomeado não deve mudar o preço; o tipo declarado na ingestão é mais confiável.
    expect(tipoDoCriativo({ mimeType: 'video/mp4', filename: 'coisa.png' })).toBe('video');
  });

  it('sem nada conhecido, assume video, que e o lado conservador', () => {
    /**
     * Vídeo cobra a duração medida; imagem cobra 15 s fixos. Um asset mal classificado como
     * imagem cobraria 15 s de algo que pode ter tocado 3 — classificado como vídeo, cobra o
     * que de fato tocou.
     */
    expect(tipoDoCriativo({})).toBe('video');
    expect(tipoDoCriativo({ filename: 'sem-extensao' })).toBe('video');
    expect(tipoDoCriativo({ mimeType: '   ' })).toBe('video');
  });

  it('imagem antiga gravada com duracao 10 ainda cobra 15 s', () => {
    /**
     * O caso que justifica derivar o tipo em vez de ler `asset.duration`. As imagens enviadas
     * antes desta regra têm `duration: 10` gravado, e a imagem fica 15 s na tela.
     */
    const antiga = { mimeType: 'image/png', filename: 'antiga.png', duration: 10 };
    expect(
      segundosCobrados(
        { kind: tipoDoCriativo(antiga), durationSec: antiga.duration },
        IMAGEM_SEGUNDOS
      )
    ).toBe(15);
  });
});
