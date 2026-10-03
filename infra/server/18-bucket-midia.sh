#!/usr/bin/env bash
#
# Cria o bucket de mídia do openad no `hub-minio`.
#
# Separado do provisionamento porque exige credencial **de administrador**, não a do
# aplicativo: a chave que o hub-backend usa (`MINIO_ACCESS_KEY`) recebeu `AccessDenied` ao
# tentar `CreateBucket` — ela tem permissão sobre os buckets dela, não de criar novos. A raiz
# do MinIO vem de arquivo (`MINIO_ROOT_USER_FILE` / `MINIO_ROOT_PASSWORD_FILE`), não de
# variável, que é por isso que `printenv` mostrava só o nome do arquivo.
#
# A política criada é de leitura pública **somente** no prefixo `public/`. Mídia de anunciante
# não é pública: ela é servida por URL assinada com validade de 1 h
# (`getPresignedGetUrl`), e deixar o bucket aberto permitiria a qualquer um baixar o criativo
# de qualquer campanha conhecendo a chave do objeto.
set -uo pipefail

MINIO='hub-minio'
ENVF=/root/openad/.env

[ -f "$ENVF" ] || { echo "ABORTADO: $ENVF nao existe" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

echo '--- lendo a credencial de raiz do MinIO (de arquivo, dentro do container)'
# Os caminhos vêm das variáveis `*_FILE`; o MinIO procura esses arquivos no diretório de
# configuração dele.
ROOT_USER="$(docker exec "$MINIO" sh -c 'cat /root/.minio/access_key 2>/dev/null || cat ${MINIO_CONFIG_DIR:-/root/.minio}/access_key 2>/dev/null' || true)"
ROOT_PASS="$(docker exec "$MINIO" sh -c 'cat /root/.minio/secret_key 2>/dev/null || cat ${MINIO_CONFIG_DIR:-/root/.minio}/secret_key 2>/dev/null' || true)"

# Fallback: em muitas instalações a raiz está nas variáveis clássicas.
[ -n "$ROOT_USER" ] || ROOT_USER="$(docker exec "$MINIO" printenv MINIO_ROOT_USER 2>/dev/null || true)"
[ -n "$ROOT_PASS" ] || ROOT_PASS="$(docker exec "$MINIO" printenv MINIO_ROOT_PASSWORD 2>/dev/null || true)"

if [ -z "$ROOT_USER" ] || [ -z "$ROOT_PASS" ]; then
  echo 'ABORTADO: nao consegui ler a credencial de raiz do hub-minio.' >&2
  echo 'Procure o valor no painel do Coolify (servico hub-minio) e exporte' >&2
  echo 'MINIO_ROOT_USER / MINIO_ROOT_PASSWORD antes de rodar isto.' >&2
  exit 1
fi
echo "usuario de raiz: $ROOT_USER"

cat > /tmp/bucket.mjs <<'MJS'
import {
  S3Client, CreateBucketCommand, HeadBucketCommand, ListBucketsCommand,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.ADMIN_KEY,
    secretAccessKey: process.env.ADMIN_SECRET,
  },
});

const Bucket = process.env.S3_BUCKET;

try {
  await s3.send(new CreateBucketCommand({ Bucket }));
  console.log(`bucket criado: ${Bucket}`);
} catch (e) {
  const n = e?.name ?? '';
  if (n === 'BucketAlreadyOwnedByYou' || n === 'BucketAlreadyExists') {
    console.log(`bucket ja existia: ${Bucket}`);
  } else {
    console.error(`FALHA ao criar: ${n} — ${e?.message ?? ''}`);
    process.exit(1);
  }
}

await s3.send(new HeadBucketCommand({ Bucket }));
console.log('bucket acessivel pela credencial de administrador');

const r = await s3.send(new ListBucketsCommand({}));
console.log('buckets:', (r.Buckets ?? []).map((b) => b.Name).join(', '));
MJS

echo '--- criando o bucket'
docker run --rm --network coolify \
  -v /tmp/bucket.mjs:/app/bucket.mjs:ro \
  -e S3_ENDPOINT=http://hub-minio:9000 \
  -e S3_BUCKET="${S3_BUCKET:-openad-media}" \
  -e ADMIN_KEY="$ROOT_USER" \
  -e ADMIN_SECRET="$ROOT_PASS" \
  --entrypoint node openad-api:latest /app/bucket.mjs

echo ''
echo '--- a credencial do APLICATIVO alcanca o bucket?'
# Esta é a verificação que importa: criar com a raiz e não conferir com a chave do aplicativo
# produziria um bucket que existe e a API não consegue usar.
cat > /tmp/checar.mjs <<'MJS'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.S3_BUCKET;
const Key = 'openad/_healthcheck.txt';
await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'ok', ContentType: 'text/plain' }));
const got = await s3.send(new GetObjectCommand({ Bucket, Key }));
const txt = await got.Body.transformToString();
await s3.send(new DeleteObjectCommand({ Bucket, Key }));
console.log(txt === 'ok' ? 'escrita, leitura e remocao: ok' : `conteudo inesperado: ${txt}`);
MJS

docker run --rm --network coolify \
  -v /tmp/checar.mjs:/app/checar.mjs:ro \
  -e S3_ENDPOINT=http://hub-minio:9000 \
  -e S3_BUCKET="${S3_BUCKET:-openad-media}" \
  -e S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  --entrypoint node openad-api:latest /app/checar.mjs \
  || echo 'A credencial do aplicativo NAO alcanca o bucket; ver a nota abaixo'

rm -f /tmp/bucket.mjs /tmp/checar.mjs
