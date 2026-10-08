#!/usr/bin/env bash
#
# Ensaio **somente leitura** do `scripts/marcar-cobranca-aplicada.ts` em producao.
#
# Para que serve: o script de dados precisa rodar antes ou junto do deploy da G.1, e a
# decisao de rodar depende de saber quantas veiculacoes ele vai tocar. Esta conferencia
# devolve exatamente a mesma contagem que o `--dry-run` do script, sem precisar levar
# `ts-node` e as dependencias do repositorio para a VPS.
#
# Por que importa, em uma frase: o processor passou a reivindicar o direito de cobrar por
# `billingAppliedAt: null`, e no Mongo `null` casa com campo **ausente** — entao toda
# veiculacao faturavel gravada antes da G.1 e reivindicavel, e um reenvio de lote antigo
# cobraria a campanha uma segunda vez. O script poe a marca no acervo; sem ele a correcao
# da cobranca duplicada **introduz** cobranca duplicada.
#
# Nada aqui escreve. Uso:  bash 89-ensaio-cobranca-aplicada.sh
set -uo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-openad-mongo}"

# A credencial sai da propria aplicacao, para nao haver segunda copia de senha em script.
URI="$(docker exec openad-api printenv MONGO_URI 2>/dev/null || true)"
if [ -z "$URI" ]; then
  echo 'ABORTADO: nao consegui ler MONGO_URI do container openad-api' >&2
  exit 1
fi

# `mongosh --quiet --eval` com saida em JSON de uma linha: e o formato que da para comparar
# com a saida do script TypeScript sem interpretacao.
docker exec "$MONGO_CONTAINER" mongosh "$URI" --quiet --eval '
  const col = db.getCollection("play_records");
  const filtro = {
    billable: true,
    reconciliationStatus: "billable",
    billingAppliedAt: { $in: [null, undefined] },
  };
  const r = {
    evento: "ensaio.marcar-cobranca-aplicada",
    playRecordsNoTotal: col.countDocuments({}),
    faturaveisSemMarca: col.countDocuments(filtro),
    jaMarcados: col.countDocuments({ billingAppliedAt: { $nin: [null, undefined] } }),
    faturaveisNoTotal: col.countDocuments({ billable: true, reconciliationStatus: "billable" }),
  };
  print(JSON.stringify(r, null, 2));
'

echo ''
echo '--- leitura do resultado ---'
echo 'faturaveisSemMarca = quantas veiculacoes o script vai marcar.'
echo 'Se for 0, o script nao tem nada a fazer e o deploy da G.1 nao corre risco de cobrar duas vezes.'
echo 'Se for maior que 0, rodar o script ANTES ou JUNTO do deploy do openad-api.'
