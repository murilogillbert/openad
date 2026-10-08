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
  /**
   * Teto de repasse (`platform_config.monetization.driverPayoutMaxPercent`).
   *
   * Opcional, com padrão 1, porque este é o caminho do faturamento: uma configuração gravada
   * antes desta chave existir não pode fazer o repasse virar zero nem lançar. O padrão 1
   * reproduz exatamente o comportamento anterior.
   */
  teto?: number;
}): number {
  const { valorFaturavelCents, repasse, piso } = params;
  const teto = params.teto ?? 1;

  // Veiculação que não fatura não reparte: filler e inventário institucional tocam de graça.
  if (valorFaturavelCents <= 0) {
    return 0;
  }

  const porPiso = Math.floor(valorFaturavelCents * piso);
  /**
   * O teto em centavos, e também o teto econômico.
   *
   * São dois limites diferentes que acabam no mesmo `min`: o econômico (não pagar mais do que
   * se recebeu) e o de política (reter ao menos 20%). O menor dos dois vence — se alguém
   * configurar o teto acima de 1, o econômico ainda protege.
   */
  const porTeto = Math.min(Math.floor(valorFaturavelCents * teto), valorFaturavelCents);

  if (!repasse) {
    return Math.min(porPiso, porTeto);
  }

  let ofertado: number;
  if (repasse.model === 'percent') {
    ofertado = Math.floor(valorFaturavelCents * (repasse.percent ?? 0));
  } else {
    ofertado = Math.floor(repasse.valueCents ?? 0);
  }

  /**
   * Rede de segurança para campanha gravada antes de o teto existir.
   *
   * Hoje `percent` pode estar em qualquer valor até 100% no banco, porque o `@Max(1)` do DTO
   * era o único limite. A validação na criação passou a recusar acima do teto, mas ela não
   * reescreve o que já está gravado — então o limite também vale aqui, no instante do
   * pagamento.
   *
   * O piso continua vencendo do teto quando os dois se cruzam (`max` antes do `min`): um teto
   * configurado abaixo do piso é configuração errada, e nesse caso pagar o piso é o
   * comportamento menos surpreendente.
   */
  return Math.min(Math.max(ofertado, porPiso), Math.max(porTeto, porPiso));
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

/**
 * Fração efetiva do valor faturável que vai para o motorista, nos dois modelos.
 *
 * Limitada ao teto, porque é esta fração que alimenta o peso do leilão: sem o limite, uma
 * campanha gravada com `percent: 1` antes do teto existir teria peso calculado sobre 100% e
 * atropelaria todas as outras — comprando entrega com um repasse que o pagamento já não
 * honra. Com piso 0,30, `k` 0,5 e teto 0,8, o peso máximo é
 * `1 + 0,5 × (0,8/0,3 − 1) ≈ 1,83`, e o limite de 3 de `boostDeRepasse` nunca é atingido.
 *
 * `teto` é opcional com padrão 1 pelo mesmo motivo de `repasseEmCentavos`: configuração
 * gravada antes da chave existir não deve alterar o comportamento.
 */
export function percentEfetivoDoRepasse(
  repasse: RepasseDaCampanha | null | undefined,
  ratePerImpressionCents: number,
  piso: number,
  teto = 1
): number {
  // Teto abaixo do piso é configuração errada; nesse caso o piso vence, como no pagamento.
  const limitar = (fracao: number) => Math.min(Math.max(fracao, piso), Math.max(teto, piso));

  if (!repasse) {
    return limitar(piso);
  }
  if (repasse.model === 'percent') {
    return limitar(repasse.percent ?? 0);
  }
  if (ratePerImpressionCents <= 0) {
    return limitar(piso);
  }
  return limitar((repasse.valueCents ?? 0) / ratePerImpressionCents);
}
