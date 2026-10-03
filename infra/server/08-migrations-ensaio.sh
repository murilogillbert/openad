#!/usr/bin/env bash
#
# Ensaio das migrations pendentes **no sandbox**, nunca em produção.
#
# O sandbox é `openad-pg-sandbox`, criado por `07-sandbox.sh` com uma cópia restaurada do
# banco de produção. Se algo aqui der errado, o custo é recriar um container.
#
# Só as pastas `prisma/` dos três repositórios precisam estar no servidor —
# `migrate deploy` lê `schema.prisma` e `migrations/`, e o CLI vem por `npx`. Copiar os
# repositórios inteiros arrastaria `node_modules` por nada. Layout esperado:
#
#   /root/openad-infra/prisma/hub/{schema.prisma,migrations/}
#   /root/openad-infra/prisma/opendriver/{schema.prisma,migrations/,bootstrap/}
#   /root/openad-infra/prisma/openad/{schema.prisma,migrations/,bootstrap/}
#
# Ordem obrigatória, e o motivo de cada passo:
#   1. hub        — dono de `public`. `openad.ad_advertisers` tem FK para `public.users`,
#                   então o schema do hub precisa estar correto antes.
#   2. opendriver — migrations commitadas e não aplicadas.
#   3. bootstrap  — cria `openad._prisma_migrations`. Sem isso o `migrate deploy` do Prisma 6
#                   aborta com "migration persistence is not initialized", porque `public` já
#                   está populado e o schema padrão não tem tabela de histórico.
#   4. openad     — cria o schema.
#
# Critério de aprovação, pelo `pg_dump --schema-only` antes e depois:
#   hub        -> `public` **deve** mudar, e exatamente o que a migration diz;
#   opendriver -> `public` **não** deve mudar;
#   openad     -> `public` **não** deve mudar.
set -uo pipefail

SANDBOX="${SANDBOX:-openad-pg-sandbox}"
PRISMA_DIR="${PRISMA_DIR:-/root/openad-infra/prisma}"
TRABALHO=/root/openad-infra/ensaio
SENHA="${SANDBOX_PASS:-sandbox-nao-exposto}"

mkdir -p "$TRABALHO"

URL_BASE="postgresql://postgres:${SENHA}@${SANDBOX}:5432/hub"

secao() { printf '\n========== %s ==========\n' "$1"; }

dump_public() {
  docker exec "$SANDBOX" pg_dump -U postgres -d hub --schema-only --schema=public
}

# `\restrict`/`\unrestrict` carregam um token aleatório que o pg_dump varia a cada execução;
# sem removê-lo, todo diff mostra quatro linhas de ruído e o critério perde o valor.
limpar() { grep -vE '^\\(un)?restrict '; }

# Roda o Prisma num container efêmero na **mesma pilha de rede** do sandbox, para alcançá-lo
# por `localhost` sem publicar porta no host.
prisma_deploy() {
  local rotulo="$1" dir="$2" url="$3"
  secao "MIGRATIONS: $rotulo"
  if [ ! -f "$dir/schema.prisma" ]; then
    echo "ABORTADO: nao encontrei $dir/schema.prisma" >&2
    return 1
  fi
  docker run --rm \
    --network "container:$SANDBOX" \
    -v "$dir":/p \
    -e DATABASE_URL="$url" \
    -e DIRECT_URL="$url" \
    -w /p \
    node:22-alpine \
    sh -c 'npx --yes prisma@6 migrate deploy --schema /p/schema.prisma' 2>&1 | tail -20
  return "${PIPESTATUS[0]}"
}

secao 'ESTADO INICIAL DO SANDBOX'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','opendriver','openad') ORDER BY 1"
echo "migrations public:     $(docker exec "$SANDBOX" psql -U postgres -d hub -At -c 'SELECT count(*) FROM public._prisma_migrations')"
echo "migrations opendriver: $(docker exec "$SANDBOX" psql -U postgres -d hub -At -c 'SELECT count(*) FROM opendriver._prisma_migrations')"

dump_public | limpar > "$TRABALHO/public-0-inicial.sql"

# ------------------------------------------------------------------------- 1. hub
# Sem `?schema=`: as tabelas do hub moram no `public`, que é o search_path padrão.
prisma_deploy hub "$PRISMA_DIR/hub" "$URL_BASE" || exit 1
dump_public | limpar > "$TRABALHO/public-1-pos-hub.sql"
secao 'DIFF DE public APOS O HUB (espera-se push_tokens)'
diff "$TRABALHO/public-0-inicial.sql" "$TRABALHO/public-1-pos-hub.sql" | head -50 || true
echo '--- objetos criados ---'
diff "$TRABALHO/public-0-inicial.sql" "$TRABALHO/public-1-pos-hub.sql" \
  | grep -oE '^\> CREATE [A-Z ]*(TABLE|INDEX)[^(]*' | sort -u || true
echo '--- objetos REMOVIDOS (deve ser vazio) ---'
diff "$TRABALHO/public-0-inicial.sql" "$TRABALHO/public-1-pos-hub.sql" \
  | grep -E '^\< (CREATE|ALTER)' | head -10 || echo '(nenhum)'

# ------------------------------------------------------------------ 2. opendriver
prisma_deploy opendriver "$PRISMA_DIR/opendriver" "$URL_BASE?schema=opendriver" || exit 1
dump_public | limpar > "$TRABALHO/public-2-pos-od.sql"
secao 'DIFF DE public APOS O OPENDRIVER (deve ser VAZIO)'
if diff -q "$TRABALHO/public-1-pos-hub.sql" "$TRABALHO/public-2-pos-od.sql" >/dev/null; then
  echo 'OK: public intocado'
else
  echo 'FALHOU: o opendriver alterou o schema do hub' >&2
  diff "$TRABALHO/public-1-pos-hub.sql" "$TRABALHO/public-2-pos-od.sql" | head -40
  exit 1
fi

# --------------------------------------------------------- 3. bootstrap do openad
secao 'BOOTSTRAP DO HISTORICO DO OPENAD'
docker cp "$PRISMA_DIR/openad/bootstrap/001_migrations_table.sql" \
  "$SANDBOX:/tmp/bootstrap.sql" >/dev/null
docker exec "$SANDBOX" psql -U postgres -d hub -q -f /tmp/bootstrap.sql
echo "openad._prisma_migrations existe: $(docker exec "$SANDBOX" psql -U postgres -d hub -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='openad' AND table_name='_prisma_migrations'")"

# ---------------------------------------------------------------------- 4. openad
prisma_deploy openad "$PRISMA_DIR/openad" "$URL_BASE?schema=openad" || exit 1
dump_public | limpar > "$TRABALHO/public-3-pos-ad.sql"
secao 'DIFF DE public APOS O OPENAD (deve ser VAZIO)'
if diff -q "$TRABALHO/public-2-pos-od.sql" "$TRABALHO/public-3-pos-ad.sql" >/dev/null; then
  echo 'OK: public intocado'
else
  echo 'FALHOU: o openad alterou o schema do hub' >&2
  diff "$TRABALHO/public-2-pos-od.sql" "$TRABALHO/public-3-pos-ad.sql" | head -40
  exit 1
fi

# -------------------------------------------------------------------- verificacao
secao 'ESTADO FINAL'
echo '--- tabelas de openad ---'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='openad' ORDER BY 1"

echo '--- trava de idempotencia do IAP ---'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT indexname FROM pg_indexes WHERE schemaname='openad' AND indexname LIKE '%store_transaction%'"

echo '--- FK cruzando schema (confdeltype r = RESTRICT) ---'
# `confdeltype` e do tipo `"char"`, e `text || "char"` e ambiguo no Postgres 16 — ha mais de
# um operador candidato. O cast explicito resolve.
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT conname || ' | ' || confdeltype::text FROM pg_constraint WHERE conname LIKE 'ad_advertisers_user_id%'"

echo '--- enum EarningType do opendriver (espera-se AdRevenue) ---'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='EarningType' ORDER BY e.enumsortorder"

echo '--- reference_id e o indice parcial ---'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='opendriver' AND table_name='driver_earnings' AND column_name='reference_id'"
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT indexname FROM pg_indexes WHERE schemaname='opendriver' AND indexname='driver_earnings_reference_id_key'"

echo '--- push_tokens no hub ---'
docker exec "$SANDBOX" psql -U postgres -d hub -At -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='push_tokens'"

secao 'ENSAIO CONCLUIDO'
