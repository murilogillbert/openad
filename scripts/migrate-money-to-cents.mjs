/**
 * Converte os campos monetarios do MongoDB de ponto flutuante na unidade maior para
 * **centavos inteiros**.
 *
 * Por que isto existe: o openad era inconsistente consigo mesmo. `campaigns.budget` guardava
 * `totalAmount` e `ratePerImpression` como `double` em reais, enquanto
 * `campaign_daily_spend` sempre contou em `billableCostCents`. O `PacingSignalService`
 * dividia o primeiro pelos dias contratados e comparava com o segundo: um orcamento de 1.000
 * virava 33 "centavos" por dia e a campanha era pausada praticamente na primeira veiculacao,
 * **cem vezes mais cedo do que o contratado**. O codigo foi corrigido; este script alinha o
 * dado que ja esta gravado.
 *
 * Campos convertidos:
 *
 * | Collection          | De                           | Para                          |
 * |---------------------|------------------------------|-------------------------------|
 * | `campaigns`         | `budget.totalAmount`         | `budget.totalAmountCents`     |
 * | `campaigns`         | `budget.ratePerImpression`   | `budget.ratePerImpressionCents` |
 * | `impression_events` | `billingValue`               | `billingValueCents`           |
 * | `report_jobs`       | `totalBillableValue`         | `totalBillableValueCents`     |
 *
 * **Idempotencia.** Cada etapa casa apenas documentos que ainda tem o campo antigo, e remove
 * esse campo no mesmo `$set`. Rodar duas vezes e inofensivo: na segunda o filtro nao casa
 * nada. Isso importa mais que elegancia — em producao o script pode ser interrompido no meio
 * de uma collection de milhoes de eventos, e retomar precisa ser seguro.
 *
 * **Arredondamento.** `$round` com zero casas, aplicado depois do `$multiply` por 100. Em
 * BSON o `double` 0.07 vale 0.07000000000000000666...; truncar daria 6 centavos, e seis
 * centavos no lugar de sete e erro de cobranca. `$round` da 7.
 *
 * **O que NAO e convertido, de proposito:** `campaign_daily_spend.billableCostCents` e
 * `budgetCents` ja estao em centavos desde sempre. `budgetCents`, porem, foi **gravado a
 * partir do valor errado** enquanto o defeito existia — por isso a etapa 5 zera as linhas de
 * pacing do dia corrente para tras: o teto diario e recalculado no proximo lancamento, a
 * partir do orcamento ja corrigido. Sem isso, campanha que estava `paused` por um teto cem
 * vezes menor continuaria parada.
 *
 * Uso:
 *   node scripts/migrate-money-to-cents.mjs --dry-run      # so relata, nao escreve
 *   node scripts/migrate-money-to-cents.mjs
 *
 * Variaveis:
 *   MONGO_URI  conexao do openad (obrigatoria em producao; tem padrao de dev)
 */
// Usa o mongoose, que ja e dependencia da API, em vez do driver `mongodb` cru: acrescentar
// dependencia so para um script de migracao e custo sem retorno. O acesso e por
// `connection.db.collection(...)`, sem modelo nem schema — de proposito, porque o schema do
// Mongoose descreve o formato **novo** e recusaria os documentos que este script existe para
// converter.
import mongoose from 'mongoose';

const URI =
  process.env.MONGO_URI ??
  'mongodb://openad:openad-dev-mongo@127.0.0.1:27017/openad?authSource=admin';

const SIMULACAO = process.argv.includes('--dry-run');

/**
 * Multiplica por 100 e arredonda, preservando o valor quando o campo antigo nao for numero.
 *
 * O `$cond` nao e zelo excessivo: `budget` era declarado `type: Object` no Mongoose, o que
 * significa que **nada ali dentro foi validado nem convertido** por toda a vida do schema.
 * Documento com orcamento em texto ou nulo e possivel, e `$multiply` sobre texto aborta o
 * pipeline inteiro — perdendo tambem os documentos validos do mesmo lote.
 */
function paraCentavos(campo) {
  return {
    $cond: [
      { $isNumber: `$${campo}` },
      { $round: [{ $multiply: [`$${campo}`, 100] }, 0] },
      0,
    ],
  };
}

/** @type {{ nome: string; collection: string; filtro: object; etapa: object[] }[]} */
const ETAPAS = [
  {
    nome: 'campaigns.budget → centavos',
    collection: 'campaigns',
    filtro: { 'budget.totalAmount': { $exists: true } },
    etapa: [
      {
        $set: {
          'budget.totalAmountCents': paraCentavos('budget.totalAmount'),
          'budget.ratePerImpressionCents': paraCentavos(
            'budget.ratePerImpression'
          ),
          // Teto diario explicito nao existia antes; nasce nulo, e o pacing deriva do total.
          'budget.dailyBudgetCents': {
            $ifNull: ['$budget.dailyBudgetCents', null],
          },
        },
      },
      { $unset: ['budget.totalAmount', 'budget.ratePerImpression'] },
    ],
  },
  {
    nome: 'impression_events.billingValue → centavos',
    collection: 'impression_events',
    filtro: { billingValue: { $exists: true } },
    etapa: [
      { $set: { billingValueCents: paraCentavos('billingValue') } },
      { $unset: 'billingValue' },
    ],
  },
  {
    nome: 'report_jobs.totalBillableValue → centavos',
    collection: 'report_jobs',
    filtro: { totalBillableValue: { $exists: true } },
    etapa: [
      {
        $set: {
          totalBillableValueCents: {
            $cond: [
              { $isNumber: '$totalBillableValue' },
              { $round: [{ $multiply: ['$totalBillableValue', 100] }, 0] },
              // `null` e legitimo aqui: job enfileirado e ainda sem total.
              null,
            ],
          },
        },
      },
      { $unset: 'totalBillableValue' },
    ],
  },
];

/** Espelha `PacingSignalService.dailyBudgetCents`. Ver a nota em {@link recalcularPacing}. */
function tetoDiarioCents(campanha) {
  const explicito = campanha?.budget?.dailyBudgetCents ?? null;
  if (typeof explicito === 'number' && explicito > 0) {
    return Math.floor(explicito);
  }
  // O `?? totalAmount * 100` cobre a simulacao: em `--dry-run` as campanhas nao foram
  // convertidas, e sem este fallback o relatorio mostraria teto 1 para todas — numero que
  // nao corresponde ao que a execucao real produziria, tornando a simulacao inutil
  // justamente para a decisao que ela existe para apoiar.
  const totalCents =
    campanha?.budget?.totalAmountCents ??
    (typeof campanha?.budget?.totalAmount === 'number'
      ? Math.round(campanha.budget.totalAmount * 100)
      : 0);
  const inicio = campanha?.scheduledStart?.getTime?.() ?? Date.now();
  const fim = campanha?.scheduledEnd?.getTime?.() ?? Date.now() + 86_400_000;
  const dias = Math.max(1, Math.ceil((fim - inicio) / 86_400_000));
  return Math.max(1, Math.floor(totalCents / dias));
}

/** Espelha `PacingSignalService.resolvePacingState`. */
function estadoDePacing(gasto, teto) {
  if (teto <= 0) return 'normal';
  if (gasto >= teto) return 'paused';
  if (gasto >= teto * 0.95) return 'near_cap';
  return 'normal';
}

/**
 * Recalcula o teto diario e o estado de pacing de `campaign_daily_spend`.
 *
 * `billableCostCents` sempre esteve correto — e sempre foi centavo. O que esta errado e
 * `budgetCents`, porque foi **derivado** do orcamento em reais: para uma campanha de 1.000
 * reais em 30 dias, gravou 33 em vez de 3.333. Campanhas ficaram `paused` por um teto cem
 * vezes menor que o contratado.
 *
 * Nao da para corrigir multiplicando por 100: o teto depende da janela contratada, e as
 * linhas antigas foram gravadas com `$setOnInsert`, entao o valor congelou no dia em que a
 * linha nasceu. Recalcular a partir da campanha ja convertida e a unica forma de chegar ao
 * numero certo.
 *
 * E tambem a razao de **nao** bastar zerar `budgetCents`: o servico so escreve esse campo em
 * `$setOnInsert`, de modo que uma linha existente com teto zero nunca mais seria corrigida —
 * e teto zero significa `pacingState: 'normal'` para sempre, ou seja, campanha sem freio pelo
 * resto do dia.
 *
 * A duplicacao das duas formulas aqui e consciente: script de migracao nao deve importar
 * codigo de aplicacao, que muda. Se o calculo do teto mudar depois, este arquivo fica como
 * registro de como o dado foi convertido naquele momento, que e o que uma auditoria precisa.
 */
async function recalcularPacing(db) {
  const pacing = db.collection('campaign_daily_spend');
  const campanhas = db.collection('campaigns');

  const linhas = await pacing.find({}).toArray();
  if (linhas.length === 0) {
    console.log('  campaign_daily_spend: nada a fazer');
    return;
  }

  const cache = new Map();
  let ajustadas = 0;
  const amostra = [];

  for (const linha of linhas) {
    if (!cache.has(linha.campaignId)) {
      cache.set(
        linha.campaignId,
        await campanhas.findOne({ campaignId: linha.campaignId })
      );
    }
    const campanha = cache.get(linha.campaignId);
    if (!campanha) {
      // Linha orfa: campanha apagada. Deixar como esta — apagar aqui seria perda de
      // historico de gasto sem necessidade, e o teto dela nunca mais sera consultado.
      continue;
    }

    const teto = tetoDiarioCents(campanha);
    const estado = estadoDePacing(linha.billableCostCents ?? 0, teto);
    if (teto === linha.budgetCents && estado === linha.pacingState) {
      continue;
    }

    if (amostra.length < 3) {
      amostra.push(
        `${linha.campaignId}@${linha.dateKey}: teto ${linha.budgetCents}→${teto}, ` +
          `estado ${linha.pacingState}→${estado}`
      );
    }
    if (!SIMULACAO) {
      await pacing.updateOne(
        { _id: linha._id },
        { $set: { budgetCents: teto, pacingState: estado } }
      );
    }
    ajustadas += 1;
  }

  console.log(
    `  campaign_daily_spend: ${ajustadas} de ${linhas.length} linha(s) ` +
      `${SIMULACAO ? 'seriam recalculadas' : 'recalculadas'}`
  );
  for (const linha of amostra) {
    console.log(`    ${linha}`);
  }
}

async function main() {
  const conexao = await mongoose.createConnection(URI).asPromise();
  const db = conexao.db;

  console.log(
    `migrate-money-to-cents: banco \`${db.databaseName}\`${SIMULACAO ? ' (simulacao)' : ''}`
  );

  try {
    for (const { nome, collection, filtro, etapa } of ETAPAS) {
      const pendentes = await db.collection(collection).countDocuments(filtro);
      if (pendentes === 0) {
        console.log(`  ${nome}: nada a fazer`);
        continue;
      }
      if (SIMULACAO) {
        const amostra = await db
          .collection(collection)
          .find(filtro)
          .limit(3)
          .toArray();
        console.log(`  ${nome}: ${pendentes} documento(s) a converter`);
        console.log(
          `    amostra: ${JSON.stringify(amostra.map((d) => d.budget ?? d.billingValue ?? d.totalBillableValue))}`
        );
        continue;
      }
      const r = await db.collection(collection).updateMany(filtro, etapa);
      console.log(`  ${nome}: ${r.modifiedCount} documento(s) convertidos`);
    }

    await recalcularPacing(db);

    console.log('migrate-money-to-cents: pronto');
  } finally {
    await conexao.close();
  }
}

main().catch((erro) => {
  console.error('migrate-money-to-cents: falhou', erro);
  process.exit(1);
});
