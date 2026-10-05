#!/usr/bin/env bash
#
# Confere CORS no download de criativo, com a origem que o WebView do tablete usa.
#
# Por que: depois de corrigir o endpoint publico e o caminho do manifesto, a sincronizacao
# passou a falhar com `Failed to fetch` — erro de rede sem status HTTP, que no navegador e a
# assinatura tipica de CORS bloqueado. O `preflight` (OPTIONS) responde 204 com
# `access-control-allow-origin: https://localhost`, entao a pergunta que falta e se a resposta
# do **GET real** tambem traz o cabecalho. Preflight liberado e resposta sem cabecalho da
# exatamente esse sintoma.
set -uo pipefail

CHAVE="${1:-openad/vfs/5d09474b-b907-4b2a-a0e0-098262ad7bcf/criativo-16x9-1791154561870.jpg}"
ORIGEM='https://localhost'

cat >/tmp/assinar.cjs <<'JS'
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const chave = process.argv[2];
const interno = (process.env.S3_ENDPOINT || '').trim() || undefined;
const publico = (process.env.S3_PUBLIC_ENDPOINT || '').trim();
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';
const base = {
  region: (process.env.S3_REGION || '').trim() || 'us-east-1',
  credentials: {
    accessKeyId: (process.env.S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY || '').trim(),
  },
};
if (interno) { base.endpoint = interno; base.forcePathStyle = forcePathStyle; }
const cliente = publico && publico !== interno
  ? new S3Client({ ...base, endpoint: publico, forcePathStyle: interno ? forcePathStyle : true })
  : new S3Client(base);
getSignedUrl(cliente, new GetObjectCommand({ Bucket: (process.env.S3_BUCKET || '').trim(), Key: chave }), { expiresIn: 600 })
  .then((u) => console.log(u))
  .catch((e) => { console.error('ERRO ' + e.message); process.exit(1); });
JS

docker cp /tmp/assinar.cjs openad-api:/app/.assinar.cjs >/dev/null
SAIDA=$(docker exec -w /app openad-api node /app/.assinar.cjs "$CHAVE" 2>&1)
docker exec -u 0 openad-api rm -f /app/.assinar.cjs 2>/dev/null || true
rm -f /tmp/assinar.cjs

URL=$(printf '%s' "$SAIDA" | grep -E '^https?://' | tail -1)
[ -z "$URL" ] && { echo "ABORTADO: nao consegui assinar:"; printf '%s\n' "$SAIDA"; exit 1; }

echo "=== 1) preflight OPTIONS com Origin: $ORIGEM"
curl -s -o /dev/null -D /tmp/h1 -X OPTIONS \
  -H "Origin: $ORIGEM" -H 'Access-Control-Request-Method: GET' \
  -w '    HTTP %{http_code}\n' --max-time 30 "$URL"
grep -i -E 'access-control|^HTTP/' /tmp/h1 | sed 's/^/    /' || echo '    (nenhum cabecalho de CORS)'

echo
echo "=== 2) GET real com Origin: $ORIGEM  (e aqui que o navegador decide)"
curl -s -o /tmp/corpo -D /tmp/h2 -H "Origin: $ORIGEM" \
  -w '    HTTP %{http_code}, %{size_download} bytes\n' --max-time 40 "$URL"
if grep -qi 'access-control-allow-origin' /tmp/h2; then
  grep -i -E 'access-control' /tmp/h2 | sed 's/^/    /'
  echo '    OK: a resposta do GET traz o cabecalho; o WebView aceita.'
  RESULTADO=0
else
  echo '    FALHA: a resposta do GET NAO traz access-control-allow-origin.'
  echo '    Com preflight liberado e GET sem o cabecalho, o fetch falha como "Failed to fetch".'
  RESULTADO=1
fi

echo
echo '=== 3) GET sem Origin (o arquivo esta servido?)'
curl -s -o /dev/null -w '    HTTP %{http_code}, %{size_download} bytes\n' --max-time 40 "$URL"

rm -f /tmp/h1 /tmp/h2 /tmp/corpo
exit $RESULTADO
