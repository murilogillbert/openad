import type { PlatformConfig } from '@openad/api-contracts';

export interface RepasseOfertado {
  model: 'percent' | 'per_play';
  percent?: number | null;
  valueCents?: number | null;
}

export interface RepasseNormalizado {
  model: 'percent' | 'per_play';
  percent: number | null;
  valueCents: number | null;
  /** Fracao efetiva do valor faturavel que vai para o motorista. */
  percentEfetivo: number;
}

/**
 * Resultado da validacao: ou `erro` esta preenchido, ou `repasse` esta.
 *
 * Nao e uniao discriminada (`{ ok: true } | { ok: false }`), que seria a forma idiomatica,
 * porque este projeto compila **sem `strictNullChecks`** (`tsconfig.base.json`): sem ele o
 * compilador nao estreita o tipo por `if (!r.ok)`, e o acesso aos campos do ramo de erro nao
 * compila. Com dois campos anulaveis a checagem funciona nos dois modos — e no dia em que o
 * `strict` for ligado, isto continua correto em vez de precisar ser reescrito.
 */
export interface ResultadoDeRepasse {
  erro: { codigo: string; mensagem: string } | null;
  repasse: RepasseNormalizado | null;
}

function recusar(codigo: string, mensagem: string): ResultadoDeRepasse {
  return { erro: { codigo, mensagem }, repasse: null };
}

function aceitar(repasse: RepasseNormalizado): ResultadoDeRepasse {
  return { erro: null, repasse };
}

function pct(fracao: number): string {
  return `${(fracao * 100).toFixed(1)}%`;
}

/**
 * Valida e normaliza o repasse ao motorista contra o piso da plataforma.
 *
 * O piso vive em `platform_config.monetization.driverPayoutMinPercent`, editavel em
 * Admin → Plataforma sem redeploy. A recusa acontece **na criacao da campanha**, nao na fila
 * de moderacao: erro de validacao devolve ao anunciante o numero exato que falta, na hora,
 * enquanto reprovar na moderacao custaria uma ida e volta humana para dizer a mesma coisa.
 *
 * Os dois modelos sao reduzidos a uma fracao comum (`percentEfetivo`), porque e dela que a
 * arbitragem precisa: o termo `boostRepasse` compara a oferta com o piso, e sem normalizar,
 * `per_play` e `percent` nao seriam comparaveis entre si.
 *
 * Funcao pura, fora de servico injetavel, para ser testada sem subir modulo — e porque a
 * regra e consultada tanto na criacao quanto na futura arbitragem.
 */
export function validarRepasse(
  oferta: RepasseOfertado | null | undefined,
  ratePerImpressionCents: number,
  config: PlatformConfig
): ResultadoDeRepasse {
  const piso = config.monetization.driverPayoutMinPercent;
  /**
   * Teto de repasse, pelo mesmo motivo que o piso, do outro lado.
   *
   * Sem teto, `percent` aceitava qualquer valor até 100% — o `@Max(1)` do DTO era o único
   * limite — e a plataforma não retinha nada daquela veiculação. O teto é política, mora no
   * `platform_config` e muda sem deploy; o `@Max(1)` continua como limite sintático.
   *
   * `?? 1` para campanha avaliada contra configuração gravada antes desta chave existir: sem
   * ele, `undefined` em toda comparação recusaria qualquer repasse.
   */
  const teto = config.monetization.driverPayoutMaxPercent ?? 1;

  if (!oferta) {
    /**
     * Ausencia nao e erro: campanha sem repasse declarado cai no piso.
     *
     * A alternativa — exigir o campo — faria toda campanha antiga e todo cliente de API que
     * nao conhece o campo falhar na criacao. Herdar o piso e o comportamento que mantem o
     * motorista pago por padrao, que e a razao de o piso existir.
     */
    return aceitar({
      model: 'percent',
      percent: piso,
      valueCents: null,
      percentEfetivo: piso,
    });
  }

  if (oferta.model === 'percent') {
    const percent = oferta.percent ?? null;
    if (percent === null) {
      return recusar(
        'DRIVER_PAYOUT_PERCENT_REQUIRED',
        'driverPayout.percent e obrigatorio quando model = percent'
      );
    }
    if (percent < piso) {
      return recusar(
        'DRIVER_PAYOUT_BELOW_FLOOR',
        `Repasse de ${pct(percent)} esta abaixo do piso da plataforma, que e ${pct(piso)}`
      );
    }
    if (percent > teto) {
      return recusar(
        'DRIVER_PAYOUT_ABOVE_CAP',
        `Repasse de ${pct(percent)} esta acima do teto de ${pct(teto)}`
      );
    }
    return aceitar({
      model: 'percent',
      percent,
      valueCents: null,
      percentEfetivo: percent,
    });
  }

  const valueCents = oferta.valueCents ?? null;
  if (valueCents === null) {
    return recusar(
      'DRIVER_PAYOUT_VALUE_REQUIRED',
      'driverPayout.valueCents e obrigatorio quando model = per_play'
    );
  }

  /**
   * Tarifa zero com repasse fixo e recusada, e nao por preciosismo aritmetico: seria uma
   * campanha que paga o motorista sem faturar nada do anunciante. Existe inventario
   * institucional com tarifa zero, mas ele nao repassa — quem veicula de graca nao gera
   * receita para repartir. E dividir por zero aqui produziria `Infinity`, que passaria pela
   * comparacao com o piso e gravaria um repasse impossivel.
   */
  if (ratePerImpressionCents <= 0) {
    return recusar(
      'DRIVER_PAYOUT_WITHOUT_REVENUE',
      'Repasse fixo exige tarifa por veiculacao maior que zero; ' +
        'inventario sem receita nao reparte receita'
    );
  }

  const percentEfetivo = valueCents / ratePerImpressionCents;
  if (percentEfetivo < piso) {
    return recusar(
      'DRIVER_PAYOUT_BELOW_FLOOR',
      `Repasse de ${valueCents} centavos sobre uma tarifa de ${ratePerImpressionCents} ` +
        `equivale a ${pct(percentEfetivo)}, abaixo do piso de ${pct(piso)}`
    );
  }

  /**
   * Repasse acima da tarifa e recusado: a plataforma pagaria mais do que recebe por
   * veiculacao. Este limite e **economico**, e vem antes do teto de politica porque a
   * mensagem e outra: "excede a receita" diz ao anunciante algo diferente de "acima do teto".
   */
  if (percentEfetivo > 1) {
    return recusar(
      'DRIVER_PAYOUT_ABOVE_REVENUE',
      `Repasse de ${valueCents} centavos excede a tarifa de ` +
        `${ratePerImpressionCents} centavos por veiculacao`
    );
  }

  if (percentEfetivo > teto) {
    return recusar(
      'DRIVER_PAYOUT_ABOVE_CAP',
      `Repasse de ${valueCents} centavos sobre uma tarifa de ${ratePerImpressionCents} ` +
        `equivale a ${pct(percentEfetivo)}, acima do teto de ${pct(teto)}`
    );
  }

  return aceitar({
    model: 'per_play',
    percent: null,
    valueCents,
    percentEfetivo,
  });
}
