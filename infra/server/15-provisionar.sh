#!/usr/bin/env bash
#
# Provisiona a infraestrutura e os serviços do openad na VPS.
#
# Gera o `.env` de produção na primeira execução e **não o sobrescreve** nas seguintes: as
# senhas do Mongo, do Redis e do RabbitMQ só têm efeito na criação do volume, então
# regenerá-las depois produziria um `.env` que não abre o banco que já existe — e o sintoma
# seria "autenticação falhou" num serviço que estava funcionando.
#
# O que é reaproveitado do que já está no ar, em vez de duplicado:
#   - Postgres compartilhado (o segundo Postgres quebraria a premissa de um banco, três schemas)
#   - `hub-minio` para armazenamento S3
#   - Traefik do Coolify para TLS e domínio
#   - `JWT_SECRET` do hub: é ele que faz um token valer nos três serviços
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
HUB_API='v6q66q2lv00ly550hffog7f5-000642067238'
OD_API='cag0pegfzuz1zfhkxgjsfzf2-000753239468'
DIR=/root/openad
ENVF="$DIR/.env"

mkdir -p "$DIR"
secao() { printf '\n========== %s ==========\n' "$1"; }

# -------------------------------------------------------------------------- .env
if [ -f "$ENVF" ]; then
  secao 'ENV JA EXISTE — mantido'
  echo "$ENVF preservado (senhas de volume nao podem ser regeneradas)"
else
  secao 'GERANDO .env DE PRODUCAO'

  gerar() { head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | head -c 40; }

  # Os três segredos compartilhados vêm dos contêineres que já rodam — não são inventados
  # aqui. `JWT_SECRET` diferente do hub quebraria a federação de identidade, e a falha
  # apareceria como "token inválido" só no app do anunciante.
  JWT_SECRET="$(docker exec "$HUB_API" printenv JWT_SECRET 2>/dev/null || true)"
  JWT_REFRESH_SECRET="$(docker exec "$HUB_API" printenv JWT_REFRESH_SECRET 2>/dev/null || true)"
  PG_PASS="$(docker exec "$PG" printenv POSTGRES_PASSWORD 2>/dev/null || true)"
  MINIO_KEY="$(docker exec "$HUB_API" printenv MINIO_ACCESS_KEY 2>/dev/null || true)"
  MINIO_SECRET="$(docker exec "$HUB_API" printenv MINIO_SECRET_KEY 2>/dev/null || true)"

  [ -n "$JWT_SECRET" ] || { echo 'ABORTADO: nao consegui ler JWT_SECRET do hub-backend' >&2; exit 1; }
  [ -n "$PG_PASS" ]    || { echo 'ABORTADO: nao consegui ler POSTGRES_PASSWORD' >&2; exit 1; }
  [ -n "$MINIO_KEY" ]  || { echo 'ABORTADO: nao consegui ler MINIO_ACCESS_KEY do hub-backend' >&2; exit 1; }

  # Sem `JWT_REFRESH_SECRET` próprio no hub, deriva-se um distinto do de acesso: usar o mesmo
  # valor para os dois faria um token de acesso ser aceito como refresh.
  [ -n "$JWT_REFRESH_SECRET" ] || JWT_REFRESH_SECRET="$(gerar)$(gerar)"

  umask 077
  cat > "$ENVF" <<EOF
# Gerado por 15-provisionar.sh. NAO versionar.
#
# As senhas de Mongo, Redis e RabbitMQ sao usadas na CRIACAO do volume. Trocar qualquer uma
# delas depois exige recriar o volume correspondente — o servico nao passa a aceitar a nova.

MONGO_ROOT_USER=openad
MONGO_ROOT_PASSWORD=$(gerar)

REDIS_PASSWORD=$(gerar)

RABBITMQ_USER=openad
RABBITMQ_PASSWORD=$(gerar)

# \`?schema=openad\` e obrigatorio: a validacao de ambiente recusa o boot sem ele, porque sem
# o parametro o historico de migrations do openad iria para o schema do hub.
DATABASE_URL=postgresql://postgres:${PG_PASS}@${PG}:5432/hub?schema=openad

# Identicos aos do hub: e o que faz um token de um servico valer nos tres.
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# Armazenamento: o hub-minio que ja existe nesta VPS (decisao de 2026-10-03).
S3_BUCKET=openad-media
S3_ACCESS_KEY_ID=${MINIO_KEY}
S3_SECRET_ACCESS_KEY=${MINIO_SECRET}

# Repasse ao motorista: o openad credita opendriver.driver_earnings por HTTP.
#
# Dominio publico, nao nome de conteiner: o Coolify renomeia o conteiner em cada deploy e nao
# registra alias estavel pelo uuid (conferido em 26-endereco-estavel.sh). Nome de conteiner
# aqui quebraria o repasse em todo deploy do opendriver, e em silencio.
OPENDRIVER_API_URL=https://api-app.opendriver.com.br

# Chave de servico com escopo ads:earning:write. Criada em Admin -> Chaves de API no hub e
# colada aqui; fica vazia na primeira execucao, e o repasse simplesmente nao e enviado (com
# aviso em log) em vez de derrubar o lote de analytics.
ECOSYSTEM_SERVICE_API_KEY=

# Primeiro super_admin do portal. Gerado por 20-admin-inicial.sh quando ainda nao existe
# nenhum usuario no Mongo; so tem efeito com a colecao vazia.
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=

LOG_LEVEL=info
EOF
  chmod 600 "$ENVF"
  echo "criado $ENVF (modo 600)"
fi

# ------------------------------------------------------- bucket de midia no MinIO
secao 'BUCKET DE MIDIA'
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

# Criado com o SDK da AWS que já está na imagem da API, **não** com `minio/mc`: a imagem do
# cliente do MinIO não é puxável do Docker Hub (`pull access denied`), e é o mesmo problema
# que já tinha derrubado o `minio/minio` no ambiente de desenvolvimento. Usar o SDK evita
# depender de um registro que recusa o download.
#
# A ordem é **`HeadBucket` primeiro, `CreateBucket` só se faltar**, e não o contrário. Depois
# de `19-minio-conta-openad.sh`, a credencial do `.env` é a da conta de serviço restrita, cuja
# política não inclui `s3:CreateBucket`: chamar `CreateBucket` num bucket que já existe
# devolveria `AccessDenied` em vez de `BucketAlreadyOwnedByYou`, e o script abortaria num
# cenário que está correto. Perguntar antes de criar é o que torna a execução repetível com a
# credencial de menor privilégio.
cat > /tmp/criar-bucket.mjs <<'MJS'
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.S3_BUCKET;

let existe = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket }));
  existe = true;
  console.log(`bucket ja existia: ${Bucket}`);
} catch (e) {
  // `NotFound`/404 é o caso legítimo de "ainda não existe". Qualquer outra coisa (403 de
  // credencial errada, conexão recusada) não deve ser confundida com bucket ausente.
  const codigo = e?.$metadata?.httpStatusCode;
  if (codigo !== 404 && e?.name !== 'NotFound' && e?.name !== 'NoSuchBucket') {
    console.error(`falha ao consultar o bucket: ${e?.name ?? ''} ${e?.message ?? ''}`);
    process.exit(1);
  }
}

if (!existe) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket }));
    console.log(`bucket criado: ${Bucket}`);
  } catch (e) {
    const c = e?.name ?? '';
    if (c === 'BucketAlreadyOwnedByYou' || c === 'BucketAlreadyExists') {
      console.log(`bucket ja existia: ${Bucket}`);
    } else {
      console.error(`falha ao criar o bucket: ${c} ${e?.message ?? ''}`);
      process.exit(1);
    }
  }
}
console.log('bucket acessivel');
MJS

docker run --rm --network coolify \
  -v /tmp/criar-bucket.mjs:/app/criar-bucket.mjs:ro \
  -e S3_ENDPOINT=http://hub-minio:9000 \
  -e S3_REGION=us-east-1 \
  -e S3_BUCKET="$S3_BUCKET" \
  -e S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  --entrypoint node \
  openad-api:latest /app/criar-bucket.mjs 2>&1 | tail -5
rm -f /tmp/criar-bucket.mjs

# ------------------------------------------------------------------- subir a pilha
secao 'SUBINDO MONGO, REDIS E RABBITMQ'
cd "$DIR"
docker compose -f docker-compose.prod.yml up -d mongo redis rabbitmq 2>&1 | tail -10

echo '--- esperando ficarem saudaveis (ate 120s)'
for i in $(seq 1 24); do
  sauda=$(docker inspect --format '{{.State.Health.Status}}' openad-mongo openad-redis openad-rabbitmq 2>/dev/null | tr '\n' ' ')
  echo "  ${i}0s: $sauda"
  case "$sauda" in
    *unhealthy*) echo 'ABORTADO: algum servico ficou unhealthy' >&2; break ;;
  esac
  if [ "$sauda" = 'healthy healthy healthy ' ]; then break; fi
  sleep 5
done

secao 'SUBINDO API E PORTAL'
docker compose -f docker-compose.prod.yml up -d api management 2>&1 | tail -10

secao 'ESTADO'
docker compose -f docker-compose.prod.yml ps
echo ''
echo '--- memoria usada pelos containers do openad ---'
docker stats --no-stream --format '{{.Name}} | {{.MemUsage}} | {{.MemPerc}}' \
  openad-mongo openad-redis openad-rabbitmq openad-api openad-management 2>/dev/null || true
echo ''
echo '--- memoria do host ---'
free -h | head -2
