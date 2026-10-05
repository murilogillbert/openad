#!/usr/bin/env bash
# Mostra o que existe, em producao, do lado da veiculacao: campanhas por estado, criativos,
# regras de agenda e aparelhos pareados.
#
# Por que: "o anuncio nao aparece no tablet" tem varias causas possiveis, e elas se excluem.
# Sem criativo aprovado e campanha ativa nao existe o que tocar, e nessa situacao consertar
# MQTT ou storage nao muda nada. Este script responde primeiro se ha conteudo.
#
# O JavaScript vai num arquivo em vez de `--eval` na linha de comando porque o PowerShell
# interpreta `$` dentro de aspas duplas: um `$group` do pipeline de agregacao chega ao
# servidor como `group`, e o mongosh devolve erro de sintaxe.
set -u

cat >/tmp/estado-veiculacao.js <<'JS'
const d = db.getSiblingDB('openad');

function conta(nome) {
  try { return d.getCollection(nome).countDocuments(); } catch (e) { return -1; }
}

print('=== colecoes');
['campaigns', 'media_assets', 'creative_assets', 'schedule_rules', 'devices', 'playback_events']
  .forEach((c) => print('  ' + c.padEnd(18) + conta(c)));

print('');
print('=== campanhas por estado');
const porEstado = d.campaigns.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
if (!porEstado.length) print('  nenhuma campanha');
porEstado.forEach((r) => print('  ' + String(r._id).padEnd(16) + r.n));

print('');
print('=== campanhas (resumo)');
d.campaigns.find({}, { campaignId: 1, name: 1, status: 1, advertiserId: 1, _id: 0 })
  .limit(10).forEach((r) => print('  ' + JSON.stringify(r)));

print('');
print('=== criativos (validationStatus / isActive)');
['media_assets', 'creative_assets'].forEach((c) => {
  if (conta(c) <= 0) return;
  d.getCollection(c).find({}, { assetId: 1, campaignId: 1, validationStatus: 1, isActive: 1, mimeType: 1, _id: 0 })
    .limit(10).forEach((r) => print('  ' + c + ' ' + JSON.stringify(r)));
});

print('');
print('=== regras de agenda');
if (conta('schedule_rules') <= 0) print('  nenhuma');
d.schedule_rules.find({}, { ruleId: 1, campaignId: 1, status: 1, _id: 0 }).limit(10)
  .forEach((r) => print('  ' + JSON.stringify(r)));

print('');
print('=== aparelhos');
if (conta('devices') <= 0) print('  nenhum aparelho pareado');
d.devices.find({}, { deviceId: 1, name: 1, status: 1, lastSeenAt: 1, _id: 0 }).limit(10)
  .forEach((r) => print('  ' + JSON.stringify(r)));
JS

docker cp /tmp/estado-veiculacao.js openad-mongo:/tmp/estado-veiculacao.js >/dev/null

# O Mongo desta instalacao exige autenticacao, e a credencial ja existe num lugar so: a
# `MONGO_URI` do proprio servico. Ler dali evita uma segunda copia de senha em arquivo de
# script, e garante que o diagnostico use exatamente a conta que a aplicacao usa.
URI=$(docker exec openad-api printenv MONGO_URI)
if [ -z "${URI:-}" ]; then
  echo 'ABORTADO: nao consegui ler MONGO_URI do container openad-api' >&2
  exit 1
fi

docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/estado-veiculacao.js
docker exec openad-mongo rm -f /tmp/estado-veiculacao.js
rm -f /tmp/estado-veiculacao.js
