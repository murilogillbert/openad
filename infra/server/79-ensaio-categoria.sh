#!/usr/bin/env bash
#
# Ensaio das duas migrations da classificacao de veiculo, **no sandbox**.
#
#   20261008090000_vehicle_category_rules      — cria detran_providers, vehicle_model_categories
#                                                e as colunas novas de vehicles
#   20261008120000_seed_vehicle_model_categories — carga inicial das regras marca/modelo
#
# O que este ensaio tem de provar, e por que cada ponto importa:
#
#   1. `public` (schema do hub) nao muda. As migrations sao do opendriver; se encostarem no
#      schema do hub, o app publicado quebra.
#   2. Os 5 veiculos existentes continuam existindo, com a mesma categoria. As colunas novas
#      tem DEFAULT, e um DEFAULT errado reescreveria a frota.
#   3. A semente entra sem conflito, e rodar a migration duas vezes nao duplica nada — o
#      ON CONFLICT precisa casar com o indice de expressao, que usa COALESCE.
#   4. A classificacao, exercitada em SQL com a mesma regra do codigo (prefixo sobre texto
#      normalizado), acerta os casos que o teste unitario cobre: GOLF nao cai na regra do GOL,
#      C3 AIRCROSS nao cai na regra do C3.
#
# Uso: bash 79-ensaio-categoria.sh
set -uo pipefail

SANDBOX='openad-pg-sandbox'
PG_PROD="${PG_PROD:-l5bcr9slmgtmeefkqwg5amia}"
PRISMA_DIR=/root/openad-infra/prisma/opendriver
SENHA="${SANDBOX_PASS:-sandbox-nao-exposto}"
TRABALHO=/root/openad-infra/ensaio-categoria
mkdir -p "$TRABALHO"

secao() { printf '\n========== %s ==========\n' "$1"; }
sb() { docker exec "$SANDBOX" psql -U postgres -d hub -At -c "$1"; }
prod() { docker exec "$PG_PROD" psql -U postgres -d hub -At -c "$1"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$SANDBOX"; then
  echo "ABORTADO: sandbox $SANDBOX nao esta rodando. Rode 07-sandbox.sh primeiro." >&2
  exit 1
fi

secao 'DIVERGENCIA CONHECIDA DO SANDBOX'
# O backup foi tirado antes de o token da Infosimples ser cadastrado. Este bloco existe para
# a divergencia ficar explicada no log do ensaio, em vez de virar duvida depois.
echo '--- chaves so em producao ---'
comm -13 <(sb "SELECT key FROM public.integration_settings ORDER BY 1") \
         <(prod "SELECT key FROM public.integration_settings ORDER BY 1")

secao 'ESTADO ANTES'
sb "SELECT count(*) || ' veiculos' FROM opendriver.vehicles"
# A contagem vai num subselect: `SELECT a || count(*) ... GROUP BY 1` agrupa pela expressao
# inteira, que inclui o proprio agregado, e o Postgres recusa.
sb "SELECT q.c || ' ' || q.v || ' x' || q.n FROM (SELECT category::text AS c, validation_status::text AS v, count(*) AS n FROM opendriver.vehicles GROUP BY 1,2) q ORDER BY 1"
echo "migrations opendriver: $(sb 'SELECT count(*) FROM opendriver._prisma_migrations')"
docker exec "$SANDBOX" pg_dump -U postgres -d hub --schema-only --schema=public \
  | grep -vE '^\\(un)?restrict ' > "$TRABALHO/public-antes.sql"
docker exec "$SANDBOX" pg_dump -U postgres -d hub --schema-only --schema=opendriver \
  | grep -vE '^\\(un)?restrict ' > "$TRABALHO/opendriver-antes.sql"

secao 'APLICANDO AS MIGRATIONS'
docker run --rm \
  --network "container:$SANDBOX" \
  -v "$PRISMA_DIR":/p \
  -e DATABASE_URL="postgresql://postgres:${SENHA}@localhost:5432/hub?schema=opendriver" \
  -w /p \
  node:22-alpine \
  sh -c 'npx --yes prisma@6 migrate deploy --schema /p/schema.prisma' 2>&1 | tail -20
rc="${PIPESTATUS[0]}"
if [ "$rc" != 0 ]; then
  echo "FALHOU: migrate deploy saiu com $rc" >&2
  exit 1
fi

secao '1. public NAO deve ter mudado'
docker exec "$SANDBOX" pg_dump -U postgres -d hub --schema-only --schema=public \
  | grep -vE '^\\(un)?restrict ' > "$TRABALHO/public-depois.sql"
if diff -q "$TRABALHO/public-antes.sql" "$TRABALHO/public-depois.sql" >/dev/null; then
  echo 'OK: schema do hub intocado'
else
  echo 'FALHOU: as migrations do opendriver alteraram o schema do hub' >&2
  diff "$TRABALHO/public-antes.sql" "$TRABALHO/public-depois.sql" | head -40
  exit 1
fi

secao '2. a frota existente continua intacta'
sb "SELECT count(*) || ' veiculos' FROM opendriver.vehicles"
sb "SELECT q.c || ' ' || q.v || ' x' || q.n FROM (SELECT category::text AS c, validation_status::text AS v, count(*) AS n FROM opendriver.vehicles GROUP BY 1,2) q ORDER BY 1"
echo '--- colunas novas, valores herdados do DEFAULT ---'
sb "SELECT q.k || ' x' || q.n FROM (SELECT 'category_source=' || category_source || ' auto=' || coalesce(category_auto::text,'(nulo)') || ' divergencia=' || category_divergence AS k, count(*) AS n FROM opendriver.vehicles GROUP BY 1) q ORDER BY 1"
echo '--- nenhum veiculo deve ter category_source diferente de driver ---'
sb "SELECT count(*) || ' fora do esperado' FROM opendriver.vehicles WHERE category_source <> 'driver' OR category_auto IS NOT NULL OR category_divergence"

secao '3. provedores de UF e regras semeadas'
sb "SELECT uf || ' | ' || label || ' | ativo=' || active || ' | login=' || requires_login FROM opendriver.detran_providers ORDER BY uf"
echo "--- regras por categoria ---"
sb "SELECT q.c || ' x' || q.n FROM (SELECT category::text AS c, count(*) AS n FROM opendriver.vehicle_model_categories GROUP BY 1) q ORDER BY 1"
echo "--- marcas cobertas ---"
sb "SELECT count(DISTINCT brand) || ' marcas, ' || count(*) || ' regras' FROM opendriver.vehicle_model_categories"
echo '--- a semente tem de ser toda source=semente ---'
sb "SELECT q.s || ' x' || q.n FROM (SELECT source AS s, count(*) AS n FROM opendriver.vehicle_model_categories GROUP BY 1) q ORDER BY 1"

secao '4. a semente e idempotente'
# Reaplicar o INSERT da semente a mao: `migrate deploy` nao roda de novo o que ja registrou,
# entao reexecutar o arquivo e o unico jeito de provar que o ON CONFLICT casa com o indice de
# expressao (COALESCE nas faixas de ano). Se o alvo do conflito estivesse errado, isto
# estouraria com violacao de unicidade.
antes=$(sb "SELECT count(*) FROM opendriver.vehicle_model_categories")
docker cp "$PRISMA_DIR/migrations/20261008120000_seed_vehicle_model_categories/migration.sql" \
  "$SANDBOX:/tmp/semente.sql" >/dev/null
if docker exec "$SANDBOX" psql -U postgres -d hub -q -v ON_ERROR_STOP=1 -f /tmp/semente.sql; then
  depois=$(sb "SELECT count(*) FROM opendriver.vehicle_model_categories")
  if [ "$antes" = "$depois" ]; then
    echo "OK: reaplicar nao duplicou nada ($antes regras antes e depois)"
  else
    echo "FALHOU: a contagem mudou de $antes para $depois" >&2
    exit 1
  fi
else
  echo 'FALHOU: reaplicar a semente deu erro — o ON CONFLICT nao casa com o indice' >&2
  exit 1
fi

secao '5. a classificacao acerta os casos dificeis'
# O SQL vive em `79-classificacao.sql` e e copiado para o container, em vez de ir por heredoc.
# Motivo: `docker exec` **sem `-i` nao repassa stdin**, e o heredoc era engolido em silencio —
# a secao mais importante do ensaio passou "sem erro" produzindo zero linha de saida. Arquivo
# com `-f` nao tem como falhar calado assim.
if [ ! -f /root/openad-infra/79-classificacao.sql ]; then
  echo 'ABORTADO: nao encontrei 79-classificacao.sql no servidor' >&2
  exit 1
fi
docker cp /root/openad-infra/79-classificacao.sql "$SANDBOX:/tmp/classificacao.sql" >/dev/null
if ! docker exec "$SANDBOX" psql -U postgres -d hub -v ON_ERROR_STOP=1 -f /tmp/classificacao.sql; then
  echo 'FALHOU: a classificacao gravada nao bate com os casos esperados' >&2
  exit 1
fi


secao '6. indices criados'
sb "SELECT indexname FROM pg_indexes WHERE schemaname='opendriver' AND (tablename='vehicle_model_categories' OR tablename='detran_providers' OR indexname LIKE 'vehicles_category%' OR indexname='vehicles_validation_status_idx') ORDER BY 1"

secao 'DIFF DO SCHEMA opendriver (o que estas migrations criaram)'
docker exec "$SANDBOX" pg_dump -U postgres -d hub --schema-only --schema=opendriver \
  | grep -vE '^\\(un)?restrict ' > "$TRABALHO/opendriver-depois.sql"
diff "$TRABALHO/opendriver-antes.sql" "$TRABALHO/opendriver-depois.sql" \
  | grep -E '^[<>] *(CREATE|ALTER|ADD|  ")' | head -60 || true
echo '--- objetos REMOVIDOS (deve ser vazio) ---'
diff "$TRABALHO/opendriver-antes.sql" "$TRABALHO/opendriver-depois.sql" \
  | grep -E '^< *(CREATE|DROP)' | head -20 || echo '(nenhum)'

secao 'ENSAIO CONCLUIDO'
