#!/usr/bin/env bash
#
# Verificação de fumaça do openad em produção, do lado do próprio serviço.
#
# O que isto responde, e por que cada item está aqui:
#
#   1. `/api/health` devolve 200 — e com os três indicadores (Mongo, Redis, painel do
#      RabbitMQ) de pé. O contêiner ficou horas `unhealthy` por um caminho errado no
#      HEALTHCHECK, com a aplicação funcionando; "o contêiner está verde" não é evidência
#      suficiente, e "o contêiner está vermelho" também não.
#   2. Nenhum aviso de índice no log. `IndexEnsureService` só registra aviso, nunca falha —
#      então um índice único que o Mongo recusou passa em silêncio, e a unicidade da placa
#      deixa de existir sem ninguém notar.
#   3. O login do `super_admin` semeado funciona de verdade. Documento no banco não prova
#      que o `bcrypt.compare` fecha.
#   4. As rotas `/internal/*` recusam quem não tem a chave de serviço e aceitam quem tem.
#      Uma rota interna que responde sem credencial é um vazamento de dado de conta.
#   5. As rotas `/advertiser/*` recusam requisição sem token.
#
# Tudo é leitura ou autenticação: nada aqui escreve em dado de negócio.
set -uo pipefail

API='openad-api'
ENVF=/root/openad/.env
BASE='http://127.0.0.1:3000'

falhas=0
ok()    { printf '  ok      %s\n' "$1"; }
falhou() { printf '  FALHOU  %s\n' "$1"; falhas=$((falhas + 1)); }
secao() { printf '\n========== %s ==========\n' "$1"; }

[ -f "$ENVF" ] || { echo "ABORTADO: $ENVF nao existe" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

# ------------------------------------------------------------------ 1. conteineres
secao 'CONTEINERES'
docker ps --format '{{.Names}} | {{.Status}}' | grep -E '^openad-' || true

for c in openad-mongo openad-redis openad-rabbitmq openad-api openad-management; do
  st=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo ausente)
  if [ "$st" = 'healthy' ]; then ok "$c healthy"; else falhou "$c esta '$st'"; fi
done

# ------------------------------------------------------------------ 2. /api/health
secao 'HEALTH'
# O corpo é impresso inteiro: um 200 com `"status":"error"` em um indicador não existe no
# terminus (ele devolve 503), mas o detalhe por indicador é o que diz *qual* dependência caiu.
corpo=$(docker exec "$API" curl -s -o /dev/stdout -w '\n__status__%{http_code}' "$BASE/api/health" 2>&1)
status=$(printf '%s' "$corpo" | sed -n 's/.*__status__\([0-9]*\)$/\1/p')
printf '%s\n' "$corpo" | sed 's/__status__[0-9]*$//'
if [ "$status" = '200' ]; then ok "/api/health = 200"; else falhou "/api/health = ${status:-sem resposta}"; fi

# ------------------------------------------------------------------ 3. indices
secao 'INDICES'
avisos=$(docker logs "$API" 2>&1 | grep -c -E 'syncIndexes failed|Expected index .* not found' || true)
if [ "$avisos" = '0' ]; then
  ok 'nenhum aviso de indice no log'
else
  falhou "$avisos aviso(s) de indice:"
  docker logs "$API" 2>&1 | grep -E 'syncIndexes failed|Expected index .* not found' | tail -4
fi

echo '--- indices da colecao vehicles'
docker exec openad-mongo mongosh --quiet \
  -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin openad \
  --eval 'db.vehicles.getIndexes().map(i => i.name).join(", ")' 2>/dev/null || echo '  (colecao ainda vazia)'

# ------------------------------------------------------------------ 4. login
secao 'LOGIN DO ADMIN'
TOKEN=$(docker exec \
  -e E="$SEED_ADMIN_EMAIL" -e P="$SEED_ADMIN_PASSWORD" \
  "$API" node -e '
fetch("http://127.0.0.1:3000/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.E, password: process.env.P }),
}).then(async (r) => {
  if (!r.ok) { process.stderr.write(`${r.status} ${await r.text()}`); process.exit(1); }
  const j = await r.json();
  process.stdout.write(j.accessToken ?? "");
});' 2>/dev/null)

if [ -n "$TOKEN" ]; then ok "login ok (token de ${#TOKEN} caracteres)"; else falhou 'login do admin'; fi

# ------------------------------------------------------------------ 5. rotas internas
secao 'ROTAS INTERNAS (/internal)'

# A verificação que importa é a **negativa**: a rota tem de recusar quem não tem a chave.
sem=$(docker exec "$API" curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/internal/ads/payouts")
case "$sem" in
  401|403) ok "sem chave de servico -> $sem" ;;
  *)       falhou "sem chave de servico -> $sem (esperado 401 ou 403)" ;;
esac

if [ -z "${ECOSYSTEM_SERVICE_API_KEY:-}" ]; then
  falhou 'ECOSYSTEM_SERVICE_API_KEY vazia no .env — o repasse nao seria enviado'
else
  # `Authorization: Bearer <chave>`, e não um cabeçalho próprio: `ServiceApiKeyGuard`
  # reimplementa deliberadamente o mesmo contrato do hub e do opendriver.
  #
  # A expansão é do shell **de fora** do contêiner, onde a variável existe. A tentativa
  # anterior passava `-e K=...` e escrevia `$K` dentro do argumento do `curl` — mas quem
  # expande `$K` ali é o shell de fora, que não tem `K`, e com `set -u` isso aborta a linha.
  # `from` e `to` são obrigatórios (`PayoutsQueryDto`, `@IsISO8601`). Sem eles a resposta é
  # 400 — o que, na primeira execução, até serviu de prova de que a chave **passou** pela
  # guarda e chegou à validação. A janela é dos últimos 7 dias.
  de=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
  ate=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  com=$(docker exec "$API" \
    curl -s -o /dev/stdout -w '\n__status__%{http_code}' \
    -H "Authorization: Bearer $ECOSYSTEM_SERVICE_API_KEY" \
    "$BASE/api/v1/internal/ads/payouts?from=$de&to=$ate" 2>&1)
  st=$(printf '%s' "$com" | sed -n 's/.*__status__\([0-9]*\)$/\1/p')
  printf '%s\n' "$com" | sed 's/__status__[0-9]*$//' | head -c 600; echo
  if [ "$st" = '200' ]; then ok "com chave de servico -> 200"; else falhou "com chave de servico -> ${st:-sem resposta}"; fi
fi

# ------------------------------------------------------------------ 6. rotas do anunciante
secao 'ROTAS DO ANUNCIANTE (/advertiser)'
an=$(docker exec "$API" curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/advertiser/campaigns")
case "$an" in
  401) ok 'sem token -> 401' ;;
  *)   falhou "sem token -> $an (esperado 401)" ;;
esac

# ------------------------------------------------------------------ 7. dependencias externas
secao 'DEPENDENCIAS COMPARTILHADAS'

# Postgres: a API fala com o schema `openad` do banco do hub. Um `SELECT 1` prova rede e
# credencial; contar as migrations prova que ela está olhando o schema certo.
docker exec "$API" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe("select count(*)::int as n from openad._prisma_migrations")
  .then((r) => console.log(`  postgres ok: ${r[0].n} migration(s) no schema openad`))
  .catch((e) => { console.log(`  postgres FALHOU: ${e.message.split("\n")[0]}`); process.exitCode = 1; })
  .finally(() => p.$disconnect());' || falhas=$((falhas + 1))

# MinIO: a credencial do `.env` é a da conta restrita criada em 19-minio-conta-openad.sh.
docker exec \
  -e S3_ENDPOINT=http://hub-minio:9000 \
  -e S3_BUCKET="$S3_BUCKET" \
  -e S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  "$API" node -e '
const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }))
  .then(() => console.log(`  minio ok: bucket ${process.env.S3_BUCKET} acessivel`))
  .catch((e) => { console.log(`  minio FALHOU: ${e.name} ${e.message}`); process.exitCode = 1; });' \
  || falhas=$((falhas + 1))

# opendriver: o destino do repasse. Só a alcançabilidade — creditar de verdade escreveria em
# `driver_earnings`, e isso é teste à parte, com limpeza.
docker exec -e U="${OPENDRIVER_API_URL:-}" "$API" sh -c '
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$U/health" 2>/dev/null)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "  opendriver alcancavel: $U/health -> $code"
  else
    echo "  opendriver INALCANCAVEL em $U"; exit 1
  fi' || falhas=$((falhas + 1))

# ------------------------------------------------------------------ resultado
secao 'RESULTADO'
if [ "$falhas" -eq 0 ]; then
  echo 'TODAS as verificacoes passaram'
  exit 0
fi
echo "$falhas verificacao(oes) FALHARAM"
exit 1
