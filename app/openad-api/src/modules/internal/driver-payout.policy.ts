/**
 * Quanto o motorista recebe por uma veiculação faturável.
 *
 * Função pura, separada de qualquer serviço, porque é consultada em três lugares que não
 * devem divergir: o crédito no momento em que a veiculação vira faturável, o relatório de
 * conferência de `/internal/ads/payouts`, e o `boostRepasse` da arbitragem. Três cópias da
 * mesma aritmética acabariam em três resultados.
 */

export interface RepasseDaCampanha {
  model: 'percent' | 'per_play';
  percent: number | null;
  valueCents: number | null;
}

/**
 * Centavos inteiros devidos ao motorista por uma veiculação.
 *
 * `piso` é `platform_config.monetization.driverPayoutMinPercent` e entra como rede de
 * segurança, não como regra principal: a validação na criação da campanha já recusa oferta
 * abaixo dele. Mas campanha gravada **antes** da política existir não passou por aquela
 * validação, e inventário institucional nasce sem `driverPayout`. Aplicar o piso aqui
 * garante que nenhuma veiculação faturável pague menos do que o combinado, qualquer que
 * tenha sido o caminho pelo qual a campanha chegou ao ar.
 *
 * Arredonda para baixo (`Math.floor`). A diferença é de no máximo um centavo por veiculação
 * e fica com a plataforma — o oposto, arredondar para cima, criaria um passivo de
 * fração de centavo multiplicado por milhões de veiculações, pago com dinheiro que não foi
 * faturado.
 */
export function repasseEmCentavos(params: {
  valorFaturavelCents: number;
  repasse: RepasseDaCampanha | null | undefined;
  piso: number;
}): number {
  const { valorFaturavelCents, repasse, piso } = params;

  // Veiculação que não fatura não reparte: filler e inventário institucional tocam de graça.
  if (valorFaturavelCents <= 0) {
    return 0;
  }

  const porPiso = Math.floor(valorFaturavelCents * piso);

  if (!repasse) {
    return Math.min(porPiso, valorFaturavelCents);
  }

  let ofertado: number;
  if (repasse.model === 'percent') {
    ofertado = Math.floor(valorFaturavelCents * (repasse.percent ?? 0));
  } else {
    ofertado = Math.floor(repasse.valueCents ?? 0);
  }

  /**
   * O teto é o próprio valor faturável, não o piso.
   *
   * Sem ele, uma campanha com `valueCents` maior que a tarifa (gravada antes da validação de
   * teto existir) faria a plataforma pagar mais do que recebeu por aquela veiculação. O
   * limite é econômico, não de política.
   */
  return Math.min(Math.max(ofertado, porPiso), valorFaturavelCents);
}

/**
 * Peso do repasse no leilão de inventário: campanha que paga mais ao motorista ganha mais
 * entrega.
 *
 * ```
 * boost = 1 + k * ((repasseOfertado / piso) - 1)
 * ```
 *
 * `k` é `platform_config.monetization.driverPayoutAuctionWeight`, e `k = 0` desliga o leilão
 * mantendo só o piso — saída segura se o comportamento em produção surpreender.
 *
 * Sem este termo o piso viraria custo fixo e ninguém pagaria acima do mínimo: não haveria
 * vantagem nenhuma em oferecer mais. Com ele, o parceiro compra relevância com dinheiro que
 * vai para o motorista.
 *
 * O resultado é limitado entre 0,5 e 3. O teto impede que dinheiro atropele relevância
 * geográfica, que é o diferencial do produto; o piso de 0,5 impede que uma campanha no piso
 * exato desapareça do inventário por um `k` mal calibrado — ela paga o combinado e tem
 * direito a veicular.
 */
export function boostDeRepasse(params: {
  percentEfetivo: number;
  piso: number;
  k: number;
}): number {
  const { percentEfetivo, piso, k } = params;
  if (k === 0 || piso <= 0) {
    return 1;
  }
  const bruto = 1 + k * (percentEfetivo / piso - 1);
  return Math.min(3, Math.max(0.5, bruto));
}

/** Fração efetiva do valor faturável que vai para o motorista, nos dois modelos. */
export function percentEfetivoDoRepasse(
  repasse: RepasseDaCampanha | null | undefined,
  ratePerImpressionCents: number,
  piso: number
): number {
  if (!repasse) {
    return piso;
  }
  if (repasse.model === 'percent') {
    return Math.max(repasse.percent ?? 0, piso);
  }
  if (ratePerImpressionCents <= 0) {
    return piso;
  }
  return Math.max((repasse.valueCents ?? 0) / ratePerImpressionCents, piso);
}
