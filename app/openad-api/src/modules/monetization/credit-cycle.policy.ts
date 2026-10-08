/**
 * Regras do ciclo de crédito: como ele é identificado, quanto se reserva por campanha, e como
 * a cota de exibições é distribuída pela frota.
 *
 * Funções puras, separadas do serviço que fala com o banco, porque é esta a parte que precisa
 * de teste — e teste de regra de dinheiro não deve depender de Postgres, de Mongo nem de
 * relógio real.
 */

import { MICROS_POR_CENTAVO } from './pricing.policy';

/**
 * Identificador do ciclo: o instante arredondado **para baixo** pelo tamanho do ciclo.
 *
 * Determinístico de propósito. Duas instâncias da API que abram o ciclo no mesmo minuto
 * calculam o mesmo `cycleId`, e o índice único `(campaignId, cycleId)` faz uma delas perder a
 * escrita — que é exatamente o resultado desejado. A alternativa, um identificador aleatório
 * por execução, reservaria o dobro quando houvesse duas instâncias, e o defeito só apareceria
 * em produção com réplica.
 *
 * O formato é legível (`2026-10-08T15:30Z`) porque ele aparece em log, em auditoria e na tela
 * do operador. Um hash seria igualmente correto e inútil para quem precisa entender o que
 * aconteceu às 15h30.
 */
export function idDoCiclo(agora: Date, minutosPorCiclo: number): string {
  const minutos = Math.max(1, Math.floor(minutosPorCiclo));
  const ms = minutos * 60_000;
  const inicio = new Date(Math.floor(agora.getTime() / ms) * ms);
  const p = (n: number, casas = 2) => String(n).padStart(casas, '0');
  return (
    `${inicio.getUTCFullYear()}-${p(inicio.getUTCMonth() + 1)}-${p(inicio.getUTCDate())}` +
    `T${p(inicio.getUTCHours())}:${p(inicio.getUTCMinutes())}Z`
  );
}

/** Início e fim do ciclo que contém `agora`. */
export function janelaDoCiclo(
  agora: Date,
  minutosPorCiclo: number
): { opensAt: Date; closesAt: Date } {
  const minutos = Math.max(1, Math.floor(minutosPorCiclo));
  const ms = minutos * 60_000;
  const inicio = Math.floor(agora.getTime() / ms) * ms;
  return { opensAt: new Date(inicio), closesAt: new Date(inicio + ms) };
}

export interface CampanhaParaReservar {
  campaignId: string;
  /** Menor é mais prioritário, como no resto do sistema. */
  priority: number;
  /** Custo de uma exibição desta campanha, em µR$. Já considera imagem × vídeo. */
  custoPorVeiculacaoMicros: number;
  /**
   * Teto de gasto do ciclo que o pacing diário já impõe, em µR$.
   *
   * Reservar além disso seria reter dinheiro que o pacing não deixaria gastar — ele ficaria
   * preso até o fim do ciclo, indisponível para outra campanha do mesmo anunciante.
   */
  tetoDoCicloMicros: number;
}

export interface ReservaDecidida {
  campaignId: string;
  amountMicros: number;
  /** Quantas exibições a reserva cobre. É a cota dura do ciclo. */
  playsNoCiclo: number;
}

export interface DecisaoDeReserva {
  reservas: ReservaDecidida[];
  /** Campanhas que ficaram sem reserva, e por quê. Vira log e tela do operador. */
  semReserva: Array<{ campaignId: string; motivo: 'sem_saldo' | 'sem_custo' | 'teto_zero' }>;
  /** Micro-reais que sobraram sem reservar. */
  sobraMicros: number;
}

/**
 * Distribui o saldo disponível entre as campanhas do anunciante, em ordem de prioridade.
 *
 * Primeiro a chegar, primeiro servido **pela prioridade declarada**, e não proporcionalmente.
 * A escolha é deliberada: rateio proporcional daria a cada campanha uma fatia que pode não
 * cobrir nem uma exibição, e o anunciante veria todas as campanhas no ar entregando quase
 * nada. Com ordem de prioridade, a campanha que ele marcou como mais importante veicula de
 * verdade, e a última fica de fora — o que é visível e corrigível.
 *
 * Cada reserva é múltiplo inteiro do custo de uma exibição. Reservar R$ 0,07 quando a exibição
 * custa R$ 0,045 retém R$ 0,025 que não podem virar exibição nenhuma: dinheiro preso até o fim
 * do ciclo, sem servir a ninguém.
 */
export function decidirReservas(params: {
  saldoDisponivelMicros: number;
  campanhas: CampanhaParaReservar[];
}): DecisaoDeReserva {
  const reservas: ReservaDecidida[] = [];
  const semReserva: DecisaoDeReserva['semReserva'] = [];
  let restante = Math.max(0, Math.floor(params.saldoDisponivelMicros));

  const ordenadas = [...params.campanhas].sort(
    (a, b) => a.priority - b.priority || a.campaignId.localeCompare(b.campaignId)
  );

  for (const c of ordenadas) {
    const custo = Math.floor(c.custoPorVeiculacaoMicros);
    if (custo <= 0) {
      /**
       * Campanha sem custo é inventário institucional ou filler: toca sem faturar, então não
       * precisa de reserva e **não deve** ser bloqueada por falta dela. Quem decide se ela
       * entra no manifesto é a elegibilidade, que trata este caso à parte.
       */
      semReserva.push({ campaignId: c.campaignId, motivo: 'sem_custo' });
      continue;
    }
    const teto = Math.floor(c.tetoDoCicloMicros);
    if (teto <= 0) {
      semReserva.push({ campaignId: c.campaignId, motivo: 'teto_zero' });
      continue;
    }

    const disponivelParaEsta = Math.min(restante, teto);
    const plays = Math.floor(disponivelParaEsta / custo);
    if (plays <= 0) {
      semReserva.push({ campaignId: c.campaignId, motivo: 'sem_saldo' });
      continue;
    }

    const valor = plays * custo;
    reservas.push({ campaignId: c.campaignId, amountMicros: valor, playsNoCiclo: plays });
    restante -= valor;
  }

  return { reservas, semReserva, sobraMicros: restante };
}

/**
 * Divide a cota de exibições do ciclo entre os tablets.
 *
 * **Sem a cota, a reserva não limita nada.** O tablet recebe o manifesto e toca em laço: é ele
 * que decide quantas vezes exibe. A reserva garante que só se captura o que foi reservado, mas
 * sem a cota o aparelho exibe além dela, e a exibição excedente simplesmente não fatura — o
 * anunciante recebe entrega que não pagou e o motorista não é creditado por ela.
 *
 * A divisão é uniforme com o resto distribuído aos primeiros, em vez de truncada: com 10
 * exibições para 3 tablets, truncar daria 3 a cada um e deixaria 1 sem uso. Aqui dá 4, 3 e 3.
 *
 * Tablet nenhum devolve lista vazia em vez de dividir por zero.
 */
export function cotaPorTablet(params: {
  playsNoCiclo: number;
  deviceIds: string[];
}): Map<string, number> {
  const cota = new Map<string, number>();
  const n = params.deviceIds.length;
  if (n === 0) return cota;

  const total = Math.max(0, Math.floor(params.playsNoCiclo));
  const base = Math.floor(total / n);
  const resto = total - base * n;

  params.deviceIds.forEach((id, i) => {
    cota.set(id, base + (i < resto ? 1 : 0));
  });
  return cota;
}

/**
 * Quanto de uma retenção ainda não foi capturado.
 *
 * É o que entra no cálculo do saldo disponível: o saldo do ledger menos a parte **não
 * capturada** das retenções abertas. A parte já capturada virou débito no ledger, então
 * subtraí-la de novo contaria o mesmo gasto duas vezes.
 */
export function restanteDaReserva(hold: {
  amountMicros: number | bigint;
  capturedMicros: number | bigint;
}): number {
  const total = Number(hold.amountMicros);
  const capturado = Number(hold.capturedMicros);
  return Math.max(0, total - capturado);
}

/**
 * Centavos de um valor em micro-reais, para a coluna fiscal do ledger.
 *
 * Arredonda para baixo. O resto fica em `amount_micros`, que é a coluna exata — então nada se
 * perde: `amount_cents` é a projeção contábil e `amount_micros` é a verdade.
 */
export function centavosDoLancamento(micros: number): number {
  return Math.floor(Math.max(0, micros) / MICROS_POR_CENTAVO);
}
