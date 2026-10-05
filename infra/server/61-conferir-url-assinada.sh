#!/usr/bin/env bash
#
# Prova que a URL pre-assinada que o manifesto entrega ao tablet funciona **de fora**.
#
# Como: roda dentro do proprio `openad-api`, com o mesmo SDK e as mesmas variaveis de
# ambiente que `AssetStorageService` usa, assina um GET para um criativo real e imprime a URL.
# Depois busca essa URL saindo pela internet.
#
# Por que de dentro do container e nao reimplementando a assinatura aqui: SigV4 inclui host,
# regiao, data e os cabecalhos assinados. Reescrever isso em bash daria uma segunda
# implementacao para divergir da que roda em producao - e o que se quer saber e se **aquela**
# funciona.
set -uo pipefail

CHAVE="${1:-openad/vfs/5d09474b-b907-4b2a-a0e0-098262ad7bcf/criativo-16x9-1791154561870.jpg}"

echo "=== endpoint de assinatura em uso"
docker exec openad-api printenv S3_ENDPOINT S3_PUBLIC_ENDPOINT S3_BUCKET 2>/dev/null || true

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
if (interno) {
  base.endpoint = interno;
  base.forcePathStyle = forcePathStyle;
}

// Mesma escolha de AssetStorageService: cliente de assinatura aponta para o endereco publico.
const cliente =
  publico && publico !== interno
    ? new S3Client({ ...base, endpoint: publico, forcePathStyle: interno ? forcePathStyle : true })
    : new S3Client(base);

getSignedUrl(cliente, new GetObjectCommand({ Bucket: (process.env.S3_BUCKET || '').trim(), Key: chave }), {
  expiresIn: 600,
})
  .then((u) => console.log(u))
  .catch((e) => {
    console.error('ERRO ' + e.message);
    process.exit(1);
  });
JS

# Copiado para dentro de /app, e executado com /app como diretorio de trabalho: o
# `require('@aws-sdk/client-s3')` resolve pelo `node_modules` da aplicacao. Em /tmp a
# resolucao falha, e a mensagem que sobra na ultima linha e so a versao do Node - foi assim
# que a primeira tentativa "abortou" sem dizer o motivo.
docker cp /tmp/assinar.cjs openad-api:/app/.assinar.cjs >/dev/null
# Sem argumento de enchimento antes da chave: a primeira versao passava um `x` ali, o script
# lia `process.argv[2]` e assinava a chave "x". O MinIO devolveu 404 - que, lido rapido,
# parece "a rota nao funciona", quando na verdade provava o contrario: 404 (nao 403) significa
# assinatura **aceita** e objeto inexistente.
SAIDA=$(docker exec -w /app openad-api node /app/.assinar.cjs "$CHAVE" 2>&1)
docker exec -u 0 openad-api rm -f /app/.assinar.cjs 2>/dev/null || true
rm -f /tmp/assinar.cjs

URL=$(printf '%s' "$SAIDA" | grep -E '^https?://' | tail -1)
if [ -z "$URL" ]; then
  echo 'ABORTADO: a assinatura falhou. Saida completa:' >&2
  printf '%s\n' "$SAIDA" >&2
  exit 1
fi

echo
echo "=== URL assinada (host visivel):"
echo "    $(echo "$URL" | sed 's/[?].*/?.../')"

case "$URL" in
  http*) : ;;
  *) echo "ABORTADO: nao consegui assinar: $URL" >&2; exit 1 ;;
esac

if echo "$URL" | grep -q 'hub-minio'; then
  echo
  echo 'FALHA: a URL saiu com o host interno hub-minio. S3_PUBLIC_ENDPOINT nao esta ativa no'
  echo '       container (recriar o servico api apos atualizar o compose).'
  exit 1
fi

echo
echo '=== buscando a URL assinada saindo pela internet (do proprio host, sem rede Docker)'
# `--noproxy` e endereco publico: o objetivo e passar pelo Traefik como o tablet passaria.
codigo=$(curl -s -o /tmp/baixado.bin -w '%{http_code}' --max-time 40 "$URL")
tam=$(stat -c %s /tmp/baixado.bin 2>/dev/null || echo 0)
tipo=$(file -b --mime-type /tmp/baixado.bin 2>/dev/null || echo '?')
rm -f /tmp/baixado.bin

echo "    HTTP $codigo, $tam bytes, $tipo"
echo
if [ "$codigo" = '200' ] && [ "$tam" -gt 1000 ]; then
  echo 'OK: o tablet consegue baixar criativo pela URL do manifesto.'
  exit 0
fi
echo 'FALHA: a URL assinada nao serviu o arquivo.' >&2
exit 1
