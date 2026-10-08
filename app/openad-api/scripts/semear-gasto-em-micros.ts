/**
 * Converte o gasto diário já acumulado de centavos para o acumulador em micro-reais.
 *
 * **Rodar uma vez, junto com o deploy do preço por segundo.**
 *
 * Por quê: `campaign_daily_spend.billableCostCents` era o acumulador, e passou a ser um valor
 * *derivado* de `billableCostMicros`. Linha gravada antes da mudança tem centavos acumulados e
 * micro-reais ausentes. O serviço tem uma guarda que impede o valor derivado de **descer**,
 * então esquecer este script não perde dado — mas deixa o gasto do dia congelado até o
 * acumulador em micro-reais alcançar o que já estava lá, e o pacing passa a comparar um número
 * defasado com o orçamento.
 *
 * Idempotente: só toca linha com `billableCostMicros` ausente ou nulo.
 *
 * Uso (da raiz do repositório):
 *   MONGODB_URI=mongodb://... pnpm exec ts-node -P app/openad-api/tsconfig.app.json \
 *     app/openad-api/scripts/semear-gasto-em-micros.ts
 *
 * `--dry-run` conta sem gravar.
 */
import mongoose from 'mongoose';

const MICROS_POR_CENTAVO = 10_000;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Defina MONGODB_URI (ou MONGO_URI) com a conexao do Mongo.');
  }
  const ensaio = process.argv.includes('--dry-run');

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('campaign_daily_spend');

  const filtro = { billableCostMicros: { $in: [null, undefined] } };
  const alvo = await col.countDocuments(filtro);
  const total = await col.countDocuments({});

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { evento: 'semear-gasto-em-micros', ensaio, linhasNoTotal: total, semMicros: alvo },
      null,
      2
    )
  );

  if (ensaio || alvo === 0) {
    await mongoose.disconnect();
    return;
  }

  /**
   * Pipeline de atualização para referenciar outro campo do mesmo documento — um `$set` comum
   * não consegue. `$ifNull` protege a linha que tenha `billableCostCents` ausente.
   */
  const r = await col.updateMany(filtro, [
    {
      $set: {
        billableCostMicros: {
          $multiply: [{ $ifNull: ['$billableCostCents', 0] }, MICROS_POR_CENTAVO],
        },
      },
    },
  ]);

  const restantes = await col.countDocuments(filtro);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        evento: 'semear-gasto-em-micros.concluido',
        encontrados: r.matchedCount,
        alterados: r.modifiedCount,
        restantes,
      },
      null,
      2
    )
  );

  if (restantes !== 0) {
    throw new Error(
      `Sobraram ${restantes} linhas de gasto sem acumulador em micro-reais; nao conclua o deploy.`
    );
  }

  await mongoose.disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
