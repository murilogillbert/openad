#!/usr/bin/env bash
#
# Cria uma conta de serviço do MinIO exclusiva do openad, limitada ao bucket `openad-media`.
#
# Por que não reusar a chave do hub: ela recebeu `AccessDenied` ao escrever em
# `openad-media` — é uma conta de serviço restrita aos buckets do hub. E por que não usar a
# raiz: credencial de raiz num serviço de aplicação dá a ele poder de apagar `hub-uploads` e
# `opendriver-private`, que guardam documento de motorista e comprovante. Um erro de código no
# openad não deve poder destruir dado dos outros dois serviços.
#
# A política é explícita e mínima: ler, escrever e remover **dentro** de `openad-media`, mais
# `ListBucket` restrito a esse bucket. Nenhuma permissão administrativa, nenhum acesso aos
# outros buckets.
#
# O `mc` vem do binário publicado nas **releases do GitHub**, não da imagem Docker nem de
# `dl.min.io`:
#   - `minio/mc` no Docker Hub devolve `pull access denied` — o mesmo problema que já havia
#     derrubado `minio/minio` no ambiente de desenvolvimento;
#   - `https://dl.min.io/client/mc/release/linux-amd64/mc` hoje devolve **HTTP 410 Gone**; a
#     MinIO deixou de servir binário por ali.
# A release do GitHub ainda publica `mc.linux-amd64.RELEASE.*` com `.sha256sum` ao lado, e o
# script confere o resumo antes de executar o binário.
set -uo pipefail

MINIO='hub-minio'
ENVF=/root/openad/.env
BUCKET="${S3_BUCKET:-openad-media}"

[ -f "$ENVF" ] || { echo "ABORTADO: $ENVF nao existe" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
BUCKET="${S3_BUCKET:-openad-media}"

ROOT_USER="$(docker exec "$MINIO" printenv MINIO_ROOT_USER)"
ROOT_PASS="$(docker exec "$MINIO" sh -c 'cat /root/.minio/secret_key 2>/dev/null || printenv MINIO_ROOT_PASSWORD')"
[ -n "$ROOT_USER" ] && [ -n "$ROOT_PASS" ] || { echo 'ABORTADO: sem credencial de raiz' >&2; exit 1; }

# Chave e segredo da conta nova. Determinísticos? Não: aleatórios, e gravados no `.env` do
# openad. Reaproveitar um valor previsível seria pior que reusar a chave do hub.
NOVA_KEY="openad$(openssl rand -hex 6)"
NOVA_SECRET="$(openssl rand -base64 32 | tr -d '\n=+/' | head -c 40)"

cat > /tmp/politica.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjetosDoOpenad",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::${BUCKET}/*"]
    },
    {
      "Sid": "ListarApenasEsteBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::${BUCKET}"]
    }
  ]
}
JSON

echo '--- baixando o mc estatico e aplicando'
docker run --rm --network coolify \
  -v /tmp/politica.json:/politica.json:ro \
  -e ROOT_USER="$ROOT_USER" -e ROOT_PASS="$ROOT_PASS" \
  -e NOVA_KEY="$NOVA_KEY" -e NOVA_SECRET="$NOVA_SECRET" \
  -e BUCKET="$BUCKET" \
  alpine:3.20 sh -c '
    set -e
    apk add --no-cache curl >/dev/null

    # Resolve a release mais recente em vez de fixar a versão: fixar um RELEASE.* que saia do
    # ar repete exatamente o problema do `dl.min.io` (410). A integridade vem do
    # `.sha256sum` publicado junto, conferido antes de executar.
    base=$(curl -fsSL https://api.github.com/repos/minio/mc/releases/latest \
      | grep -o "https://[^\"]*mc\.linux-amd64\.RELEASE\.[0-9TZ-]*" | head -1)
    [ -n "$base" ] || { echo "nao consegui resolver a url do mc na release do github"; exit 1; }
    echo "mc: $base"

    curl -fsSL "$base" -o /usr/local/bin/mc
    curl -fsSL "$base.sha256sum" -o /tmp/mc.sha256sum
    # O arquivo publicado nomeia `mc.linux-amd64.RELEASE.*`; o resumo é conferido contra o
    # caminho onde o binário foi salvo.
    esperado=$(cut -d" " -f1 /tmp/mc.sha256sum)
    obtido=$(sha256sum /usr/local/bin/mc | cut -d" " -f1)
    [ "$esperado" = "$obtido" ] || {
      echo "ABORTADO: sha256 do mc nao confere (esperado $esperado, obtido $obtido)"; exit 1; }
    echo "sha256 do mc conferido"

    chmod +x /usr/local/bin/mc
    mc alias set m "http://hub-minio:9000" "$ROOT_USER" "$ROOT_PASS" >/dev/null

    echo "buckets existentes:"
    mc ls m

    # Política: criada ou substituída. `mc admin policy create` falha se já existe, então a
    # remoção antes torna a execução repetível.
    mc admin policy rm m openad-media-rw >/dev/null 2>&1 || true
    mc admin policy create m openad-media-rw /politica.json

    # Usuário dedicado. Idem: remove antes para poder rodar de novo.
    mc admin user rm m "$NOVA_KEY" >/dev/null 2>&1 || true
    mc admin user add m "$NOVA_KEY" "$NOVA_SECRET"
    mc admin policy attach m openad-media-rw --user "$NOVA_KEY"

    echo "--- verificando o que a conta nova PODE fazer"
    mc alias set n "http://hub-minio:9000" "$NOVA_KEY" "$NOVA_SECRET" >/dev/null
    echo ok > /tmp/t.txt
    mc cp /tmp/t.txt "n/$BUCKET/openad/_healthcheck.txt" >/dev/null
    mc cat "n/$BUCKET/openad/_healthcheck.txt"
    mc rm "n/$BUCKET/openad/_healthcheck.txt" >/dev/null
    echo "escrita, leitura e remocao em $BUCKET: ok"

    echo "--- verificando o que ela NAO pode fazer (esperado: falhar)"
    if mc ls n/hub-uploads >/dev/null 2>&1; then
      echo "ATENCAO: a conta do openad alcanca hub-uploads — a politica esta larga demais"
      exit 1
    fi
    echo "hub-uploads inacessivel: correto"
    if mc ls n/opendriver-private >/dev/null 2>&1; then
      echo "ATENCAO: a conta do openad alcanca opendriver-private"
      exit 1
    fi
    echo "opendriver-private inacessivel: correto"
  '
estado=$?
rm -f /tmp/politica.json

if [ "$estado" -ne 0 ]; then
  echo 'ABORTADO: a conta nao foi criada ou a politica ficou errada' >&2
  exit 1
fi

echo '--- gravando a credencial nova no .env do openad'
sed -i "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=$NOVA_KEY|" "$ENVF"
sed -i "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$NOVA_SECRET|" "$ENVF"
echo "S3_ACCESS_KEY_ID=$NOVA_KEY gravado (o segredo nao e exibido)"
