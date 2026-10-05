#!/usr/bin/env bash
# Mostra o que existe, em producao, do lado da veiculacao.
#
# Por que: "o anuncio nao aparece no tablet" tem varias causas possiveis, e elas se excluem.
# Sem criativo aprovado e agenda nao existe o que tocar, e nessa situacao consertar MQTT ou
# storage nao muda nada. Este script responde primeiro se ha conteudo.
#
# A primeira versao **listava nomes de colecao chutados** (`media_assets`, `creative_assets`,
# `schedule_rules`) e `countDocuments` devolve 0 para colecao que nao existe. O relatorio saiu
# dizendo "zero criativos" quando o criativo estava em outra colecao - mesma armadilha do
# `aapt2` que dizia "ok" sem ler nada. Agora o script **enumera** o que existe e so depois
# conta.
#
# O JavaScript vai num arquivo em vez de `--eval` porque o PowerShell interpreta `$` dentro de
# aspas duplas: um `$group` do pipeline de agregacao chega ao servidor como `group`.
set -u

cat >/tmp/estado-veiculacao.js <<'JS'
const d = db.getSiblingDB('openad');

print('=== colecoes que existem (nome: documentos)');
const nomes = d.getCollectionNames().sort();
nomes.forEach((n) => {
  let c = '?';
  try { c = d.getCollection(n).countDocuments(); } catch (e) { c = 'erro'; }
  print('  ' + n.padEnd(28) + c);
});

function existe(n) { return nomes.indexOf(n) >= 0; }

/** Primeira colecao existente entre as candidatas, para nao depender de um nome fixo. */
function escolher(candidatas) {
  for (const c of candidatas) if (existe(c)) return c;
  return null;
}

print('');
print('=== campanhas por estado');
if (!existe('campaigns')) {
  print('  colecao campaigns nao existe');
} else {
  const r = d.campaigns.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
  if (!r.length) print('  nenhuma campanha');
  r.forEach((x) => print('  ' + String(x._id).padEnd(16) + x.n));

  print('');
  print('=== campanhas (resumo)');
  d.campaigns.find({}, { campaignId: 1, name: 1, status: 1, _id: 0 }).limit(12)
    .forEach((x) => print('  ' + JSON.stringify(x)));
}

const colMidia = escolher(['media', 'media_assets', 'mediaassets', 'creative_assets', 'assets']);
print('');
print('=== criativos  (colecao: ' + (colMidia || 'nenhuma encontrada') + ')');
if (colMidia) {
  const total = d.getCollection(colMidia).countDocuments();
  print('  total: ' + total);
  d.getCollection(colMidia)
    .find({}, { mediaId: 1, filename: 1, validationStatus: 1, probeStatus: 1, isActive: 1, mimeType: 1, campaignIds: 1, _id: 0 })
    .limit(10).forEach((x) => print('  ' + JSON.stringify(x)));
}

const colAgenda = escolher(['schedulerules', 'schedule_rules', 'scheduleRules', 'schedules']);
print('');
print('=== regras de agenda  (colecao: ' + (colAgenda || 'nenhuma encontrada') + ')');
if (colAgenda) {
  print('  total: ' + d.getCollection(colAgenda).countDocuments());
  d.getCollection(colAgenda).find({}, { ruleId: 1, campaignId: 1, status: 1, mediaId: 1, _id: 0 })
    .limit(10).forEach((x) => print('  ' + JSON.stringify(x)));
}

const colAparelho = escolher(['devices', 'device']);
print('');
print('=== aparelhos  (colecao: ' + (colAparelho || 'nenhuma encontrada') + ')');
if (colAparelho) {
  d.getCollection(colAparelho)
    .find({}, { deviceId: 1, name: 1, status: 1, lastSeenAt: 1, geoZoneId: 1, _id: 0 })
    .limit(10).forEach((x) => print('  ' + JSON.stringify(x)));
}
JS

docker cp /tmp/estado-veiculacao.js openad-mongo:/tmp/estado-veiculacao.js >/dev/null

# A credencial ja existe num lugar so: a `MONGO_URI` do proprio servico. Ler dali evita uma
# segunda copia de senha em script, e garante que o diagnostico use a conta da aplicacao.
URI=$(docker exec openad-api printenv MONGO_URI)
if [ -z "${URI:-}" ]; then
  echo 'ABORTADO: nao consegui ler MONGO_URI do container openad-api' >&2
  exit 1
fi

docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/estado-veiculacao.js
docker exec openad-mongo rm -f /tmp/estado-veiculacao.js
rm -f /tmp/estado-veiculacao.js
