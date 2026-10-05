#!/usr/bin/env bash
# Que tipo de arquivo o servidor esta mandando para o tablete?
#
# O player monta um unico `<video>` para todo item do manifesto. Se algum criativo for
# imagem, o `<video>` nunca decodifica e a tela fica num retangulo preto — exatamente o
# sintoma relatado. O manifesto hoje nao carrega `mimeType`, entao a unica forma de saber o
# que ha la e olhar o documento: `mimeType`, extensao do `filename` e `codec`.
set -u

cat >/tmp/tipos.js <<'JS'
const d = db.getSiblingDB('openad');

print('=== mediaassets: tipo, nome, tamanho, duracao');
d.mediaassets.find({}, {
  mediaId: 1, mimeType: 1, filename: 1, fileSize: 1, duration: 1,
  codec: 1, width: 1, height: 1, isActive: 1, validationStatus: 1,
  campaignId: 1, storageUrl: 1, _id: 0,
}).forEach((x) => {
  print('  --- ' + x.mediaId);
  print('      mimeType   ' + (x.mimeType === undefined ? '<AUSENTE>' : JSON.stringify(x.mimeType)));
  print('      filename   ' + JSON.stringify(x.filename));
  print('      fileSize   ' + x.fileSize);
  print('      duration   ' + x.duration);
  print('      codec      ' + x.codec);
  print('      dimensoes  ' + x.width + 'x' + x.height);
  print('      isActive   ' + x.isActive + '   validation ' + x.validationStatus);
  print('      campaignId ' + x.campaignId);
  print('      storageUrl ' + String(x.storageUrl).slice(0, 100));
});

print('');
print('=== contagem por mimeType');
d.mediaassets.aggregate([
  { $group: { _id: '$mimeType', n: { $sum: 1 } } },
]).forEach((g) => print('  ' + String(g._id) + ' -> ' + g.n));
JS

docker cp /tmp/tipos.js openad-mongo:/tmp/tipos.js >/dev/null
URI=$(docker exec openad-api printenv MONGO_URI)
[ -z "${URI:-}" ] && { echo 'ABORTADO: MONGO_URI vazia' >&2; exit 1; }
docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/tipos.js
docker exec openad-mongo rm -f /tmp/tipos.js
rm -f /tmp/tipos.js
