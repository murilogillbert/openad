/**
 * Marca como já cobradas as veiculações faturáveis que existem antes de `billingAppliedAt`.
 *
 * **Rodar uma vez, antes ou junto com o deploy da G.1.** Sem isto, a correção da cobrança
 * duplicada introduz um risco de cobrança duplicada — o oposto do que ela existe para fazer.
 *
 * Por quê: o processor passou a reivindicar o direito de cobrar por
 * `findOneAndUpdate({ reconciliationStatus: 'billable', billable: true, billingAppliedAt: null })`.
 * Veiculação gravada antes desta mudança não tem o campo, e `null` no Mongo casa com campo
 * ausente — então ela é reivindicável. No código antigo, uma veiculação já `billable` **não**
 * seria cobrada de novo, porque a condição olhava a transição a partir de `pending`. Deixar o
 * acervo sem marca inverteria essa proteção: o próximo reenvio de um lote antigo cobraria a
 * campanha uma segunda vez.
 *
 * O instante usado é `timestampEnd` da própria veiculação, e não `now()`: é a data em que a
 * cobrança de fato ocorreu, e gravar "agora" criaria um histórico que diz que tudo foi cobrado
 * no dia do deploy.
 *
 * Idempotente: só toca documento com `billingAppliedAt` ausente ou nulo. Rodar de novo não faz
 * nada.
 *
 * Uso (da raiz do repositório):
 *   MONGODB_URI=mongodb://... pnpm exec ts-node -P app/openad-api/tsconfig.app.json \
 *     app/openad-api/scripts/marcar-cobranca-aplicada.ts
 *
 * `--dry-run` conta sem gravar.
 */
import mongoose from 'mongoose';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Defina MONGODB_URI (ou MONGO_URI) com a conexao do Mongo.');
  }
  const ensaio = process.argv.includes('--dry-run');

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('play_records');

  const filtro = {
    billable: true,
    reconciliationStatus: 'billable',
    billingAppliedAt: { $in: [null, undefined] },
  };

  const alvo = await col.countDocuments(filtro);
  const total = await col.countDocuments({});
  const jaMarcados = await col.countDocuments({
    billingAppliedAt: { $nin: [null, undefined] },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        evento: 'marcar-cobranca-aplicada',
        ensaio,
        playRecordsNoTotal: total,
        faturaveisSemMarca: alvo,
        jaMarcados,
      },
      null,
      2
    )
  );

  if (ensaio || alvo === 0) {
    await mongoose.disconnect();
    return;
  }

  /**
   * `$set` com expressão de agregação (`updateMany` com pipeline) para copiar `timestampEnd`
   * para `billingAppliedAt` documento por documento. Um `$set` comum não consegue referenciar
   * outro campo do mesmo documento.
   */
  const r = await col.updateMany(filtro, [
    { $set: { billingAppliedAt: '$timestampEnd' } },
  ]);

  const restantes = await col.countDocuments(filtro);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        evento: 'marcar-cobranca-aplicada.concluido',
        encontrados: r.matchedCount,
        alterados: r.modifiedCount,
        restantesSemMarca: restantes,
      },
      null,
      2
    )
  );

  if (restantes !== 0) {
    throw new Error(
      `Sobraram ${restantes} veiculacoes faturaveis sem marca de cobranca; nao conclua o deploy.`
    );
  }

  await mongoose.disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
