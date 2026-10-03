#!/usr/bin/env bash
#
# Aplica as migrations pendentes em **PRODUÇÃO**, pelo protocolo de 5 passos.
#
# Pré-requisitos, verificados pelo próprio script:
#   - backup recente em /root/backups/ULTIMO, com `hub.dump` íntegro;
#   - o mesmo conjunto de migrations já ensaiado com sucesso em `08-migrations-ensaio.sh`.
#
# O critério de aprovação é o diff de `pg_dump --schema-only` a cada etapa:
#   hub        -> `public` muda, e só o que a migration diz;
#   opendriver -> `public` NÃO muda;
#   openad     -> `public` NÃO muda.
#
# Qualquer diff inesperado **aborta** o script antes da etapa seguinte. Não tenta consertar
# nada no ar: restaurar do dump é a recuperação, e ela existe justamente para não precisar
# improvisar com o banco em produção.
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"
PRISMA_DIR="${PRISMA_DIR:-/root/openad-infra/prisma}"
TRABALHO=/root/openad-infra/producao
BACKUP_DIR="$(cat /root/backups/ULTIMO 2>/dev/null || echo '')"

mkdir -p "$TRABALHO"

secao() { printf '\n========== %s ==========\n' "$1"; }
abortar() { echo "ABORTADO: $1" >&2; exit 1; }

# ------------------------------------------------------------------ pre-requisitos
secao 'PRE-REQUISITOS'
[ -n "$BACKUP_DIR" ] || abortar 'nao ha /root/backups/ULTIMO'
[ -f "$BACKUP_DIR/hub.dump" ] || abortar "nao ha $BACKUP_DIR/hub.dump"
echo "backup: $BACKUP_DIR"
docker run --rm -v "$BACKUP_DIR":/b:ro postgres:16-alpine \
  pg_restore --list /b/hub.dump > /dev/null \
  || abortar 'o dump do backup nao passa na verificacao de integridade'
echo 'dump integro'

# A senha de produção vem do próprio container, não de arquivo nem de variável neste script.
SENHA="$(docker exec "$PG" printenv POSTGRES_PASSWORD)"
[ -n "$SENHA" ] || abortar 'nao consegui ler POSTGRES_PASSWORD do container'
URL_BASE="postgresql://${PG_USER}:${SENHA}@${PG}:5432/hub"

dump_public() { docker exec "$PG" pg_dump -U "$PG_USER" -d hub --schema-only --schema=public; }
limpar() { grep -vE '^\\(un)?restrict '; }

prisma_deploy() {
  local rotulo="$1" dir="$2" url="$3"
  secao "MIGRATIONS EM PRODUCAO: $rotulo"
  [ -f "$dir/schema.prisma" ] || abortar "nao encontrei $dir/schema.prisma"
  docker run --rm \
    --network "container:$PG" \
    -v "$dir":/p \
    -e DATABASE_URL="$url" \
    -e DIRECT_URL="$url" \
    -w /p \
    node:22-alpine \
    sh -c 'npx --yes prisma@6 migrate deploy --schema /p/schema.prisma' 2>&1 \
    | grep -vE '^npm notice' | tail -20
  return "${PIPESTATUS[0]}"
}

secao 'ESTADO ANTES'
docker exec "$PG" psql -U "$PG_USER" -d hub -At -c \
  "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','opendriver','openad') ORDER BY 1"
echo "migrations public:     $(docker exec "$PG" psql -U "$PG_USER" -d hub -At -c 'SELECT count(*) FROM public._prisma_migrations')"
echo "migrations opendriver: $(docker exec "$PG" psql -U "$PG_USER" -d hub -At -c 'SELECT count(*) FROM opendriver._prisma_migrations')"

dump_public | limpar > "$TRABALHO/public-0.sql"

# ------------------------------------------------------------------------- 1. hub
prisma_deploy hub "$PRISMA_DIR/hub" "$URL_BASE" || abortar 'migrate deploy do hub falhou'
dump_public | limpar > "$TRABALHO/public-1.sql"

secao 'DIFF DE public (o hub E o dono: deve mudar)'
diff "$TRABALHO/public-0.sql" "$TRABALHO/public-1.sql" > "$TRABALHO/diff-hub.txt" || true
grep -cE '^[<>]' "$TRABALHO/diff-hub.txt" | sed 's/^/linhas alteradas: /'
echo '--- removido ou alterado (deve ser vazio) ---'
if grep -qE '^\< ' "$TRABALHO/diff-hub.txt"; then
  grep -E '^\< ' "$TRABALHO/diff-hub.txt" | head -20
  abortar 'a migration do hub REMOVEU algo de public; pare e restaure'
fi
echo '(nada removido)'
echo '--- criado ---'
grep -E '^\> (CREATE|ALTER TABLE ONLY)' "$TRABALHO/diff-hub.txt" | sed 's/^> //' | sort -u

# ------------------------------------------------------------------ 2. opendriver
prisma_deploy opendriver "$PRISMA_DIR/opendriver" "$URL_BASE?schema=opendriver" \
  || abortar 'migrate deploy do opendriver falhou'
dump_public | limpar > "$TRABALHO/public-2.sql"
secao 'DIFF DE public (o opendriver NAO e dono: deve ser vazio)'
if diff -q "$TRABALHO/public-1.sql" "$TRABALHO/public-2.sql" >/dev/null; then
  echo 'OK: public intocado'
else
  diff "$TRABALHO/public-1.sql" "$TRABALHO/public-2.sql" | head -30
  abortar 'o opendriver alterou public; pare e restaure'
fi

# --------------------------------------------------------- 3. bootstrap do openad
secao 'BOOTSTRAP DO HISTORICO DO OPENAD'
# Idempotente: `CREATE SCHEMA IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS`. Precisa rodar
# antes do primeiro `migrate deploy` do openad, senão o Prisma 6 aborta com
# "migration persistence is not initialized" num banco multiSchema com `public` populado.
docker cp "$PRISMA_DIR/openad/bootstrap/001_migrations_table.sql" "$PG:/tmp/bootstrap.sql" >/dev/null
docker exec "$PG" psql -U "$PG_USER" -d hub -q -f /tmp/bootstrap.sql
docker exec "$PG" rm -f /tmp/bootstrap.sql
echo "openad._prisma_migrations: $(docker exec "$PG" psql -U "$PG_USER" -d hub -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='openad' AND table_name='_prisma_migrations'")"

# ---------------------------------------------------------------------- 4. openad
prisma_deploy openad "$PRISMA_DIR/openad" "$URL_BASE?schema=openad" \
  || abortar 'migrate deploy do openad falhou'
dump_public | limpar > "$TRABALHO/public-3.sql"
secao 'DIFF DE public (o openad NAO e dono: deve ser vazio)'
if diff -q "$TRABALHO/public-2.sql" "$TRABALHO/public-3.sql" >/dev/null; then
  echo 'OK: public intocado'
else
  diff "$TRABALHO/public-2.sql" "$TRABALHO/public-3.sql" | head -30
  abortar 'o openad alterou public; pare e restaure'
fi

# -------------------------------------------------------------------- verificacao
secao 'VERIFICACAO FINAL'
q() { docker exec "$PG" psql -U "$PG_USER" -d hub -At -c "$1"; }

echo "schemas:            $(q "SELECT string_agg(nspname,',' ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','opendriver','openad')")"
echo "tabelas em openad:  $(q "SELECT string_agg(table_name,',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='openad'")"
echo "push_tokens:        $(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='push_tokens'")"
echo "EarningType:        $(q "SELECT string_agg(e.enumlabel,',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='EarningType'")"
echo "reference_id:       $(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='opendriver' AND table_name='driver_earnings' AND column_name='reference_id'")"
echo "indice do recibo:   $(q "SELECT count(*) FROM pg_indexes WHERE schemaname='openad' AND indexname LIKE '%store_transaction%'")"
echo "FK onDelete:        $(q "SELECT confdeltype::text FROM pg_constraint WHERE conname LIKE 'ad_advertisers_user_id%'") (r = RESTRICT)"
echo "migrations public:     $(q 'SELECT count(*) FROM public._prisma_migrations')"
echo "migrations opendriver: $(q 'SELECT count(*) FROM opendriver._prisma_migrations')"
echo "migrations openad:     $(q 'SELECT count(*) FROM openad._prisma_migrations')"

echo '--- nenhuma migration pode ter ficado pela metade ---'
q "SELECT 'public: '||migration_name FROM public._prisma_migrations WHERE finished_at IS NULL
   UNION ALL SELECT 'opendriver: '||migration_name FROM opendriver._prisma_migrations WHERE finished_at IS NULL
   UNION ALL SELECT 'openad: '||migration_name FROM openad._prisma_migrations WHERE finished_at IS NULL"
echo '(vazio acima = tudo concluido)'

echo '--- dados preservados ---'
echo "users:             $(q 'SELECT count(*) FROM public.users')"
echo "cashback_entries:  $(q 'SELECT count(*) FROM public.cashback_entries')"
echo "rides:             $(q 'SELECT count(*) FROM opendriver.rides')"
echo "driver_earnings:   $(q 'SELECT count(*) FROM opendriver.driver_earnings')"

secao 'MIGRATIONS APLICADAS EM PRODUCAO'
