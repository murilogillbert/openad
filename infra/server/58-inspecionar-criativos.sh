#!/usr/bin/env bash
# Mostra os documentos de criativo e de aparelho **inteiros**, sem projecao.
#
# Por que sem projecao: o diagnostico anterior pediu `campaignIds` e o campo simplesmente nao
# apareceu na saida. Campo ausente e campo com outro nome sao indistinguiveis quando se
# projeta - e e exatamente a diferenca entre "o criativo nao esta ligado a campanha" e "eu
# pedi a chave errada".
set -u

cat >/tmp/inspecionar.js <<'JS'
const d = db.getSiblingDB('openad');

print('=== mediaassets (documentos completos, chaves no topo)');
d.mediaassets.find().limit(4).forEach((x) => {
  print('  --- ' + (x.mediaId || x._id));
  Object.keys(x).sort().forEach((k) => {
    let v = x[k];
    if (v && typeof v === 'object') v = JSON.stringify(v).slice(0, 120);
    print('      ' + k.padEnd(22) + String(v).slice(0, 120));
  });
});

print('');
print('=== quantos mediaassets tem campaignId preenchido');
print('  com campaignId  : ' + d.mediaassets.countDocuments({ campaignId: { $exists: true, $ne: null } }));
print('  aprovados+ativos: ' + d.mediaassets.countDocuments({ isActive: true, validationStatus: 'approved' }));
print('  os tres juntos  : ' + d.mediaassets.countDocuments({ campaignId: { $exists: true, $ne: null }, isActive: true, validationStatus: 'approved' }));

print('');
print('=== devices (documento completo)');
d.devices.find().limit(2).forEach((x) => {
  print('  --- ' + (x.deviceId || x._id));
  Object.keys(x).sort().forEach((k) => {
    let v = x[k];
    if (v && typeof v === 'object') v = JSON.stringify(v).slice(0, 160);
    print('      ' + k.padEnd(24) + String(v).slice(0, 160));
  });
});

print('');
print('=== campanhas (documento completo da primeira active)');
const c = d.campaigns.findOne({ status: 'active' });
if (c) {
  Object.keys(c).sort().forEach((k) => {
    let v = c[k];
    if (v && typeof v === 'object') v = JSON.stringify(v).slice(0, 160);
    print('      ' + k.padEnd(24) + String(v).slice(0, 160));
  });
}
JS

docker cp /tmp/inspecionar.js openad-mongo:/tmp/inspecionar.js >/dev/null
URI=$(docker exec openad-api printenv MONGO_URI)
[ -z "${URI:-}" ] && { echo 'ABORTADO: MONGO_URI vazia' >&2; exit 1; }
docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/inspecionar.js
docker exec openad-mongo rm -f /tmp/inspecionar.js
rm -f /tmp/inspecionar.js
