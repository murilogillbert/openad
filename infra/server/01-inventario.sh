#!/usr/bin/env bash
#
# Janela 1 — inventario do servidor de producao. **Somente leitura.**
#
# Substitui "a documentacao diz" por "eu li do banco". Nenhum comando aqui escreve nada:
# e seguro rodar a qualquer momento, inclusive com o servico no ar.
#
# Uso:  bash 01-inventario.sh
set -uo pipefail

PG_CONTAINER="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-hub}"

psql_q() { docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c "$1" 2>&1; }

secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'HOST'
hostname
uname -sr
echo "cpus: $(nproc)"
free -h | head -2
df -h / | tail -1

secao 'CONTAINERS NO AR'
docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}'

secao 'POSTGRES: IDENTIDADE'
docker exec "$PG_CONTAINER" postgres --version
echo "usuario: $(docker exec "$PG_CONTAINER" printenv POSTGRES_USER)"
echo "banco:   $(docker exec "$PG_CONTAINER" printenv POSTGRES_DB)"

secao 'POSTGRES: BANCOS E TAMANHOS'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -At -F '|' -c \
  "SELECT datname, pg_size_pretty(pg_database_size(datname))
     FROM pg_database WHERE datallowconn
    ORDER BY pg_database_size(datname) DESC" 2>&1

secao 'SCHEMAS DO BANCO hub'
# Confirma se `openad` ja existe. A expectativa e: public e opendriver existem, openad nao.
psql_q "SELECT nspname FROM pg_namespace
         WHERE nspname IN ('public','opendriver','openad') ORDER BY nspname"

secao 'MIGRATIONS APLICADAS EM public (dono: hub)'
psql_q "SELECT migration_name || ' | ' || COALESCE(finished_at::text,'NAO TERMINOU')
          FROM public._prisma_migrations ORDER BY finished_at"

secao 'MIGRATIONS APLICADAS EM opendriver'
psql_q "SELECT migration_name || ' | ' || COALESCE(finished_at::text,'NAO TERMINOU')
          FROM opendriver._prisma_migrations ORDER BY finished_at"

secao 'MIGRATIONS COM FALHA (qualquer schema)'
# Linha com `finished_at` nulo e migration que abortou no meio. Se houver, o `migrate deploy`
# se recusa a seguir ate alguem resolver — e precisa ser resolvida com a cabeca fria, nao no
# meio de uma janela de implantacao.
psql_q "SELECT 'public: ' || migration_name FROM public._prisma_migrations WHERE finished_at IS NULL
         UNION ALL
        SELECT 'opendriver: ' || migration_name FROM opendriver._prisma_migrations WHERE finished_at IS NULL"
echo '(vazio acima = nenhuma migration pendente ou quebrada)'

secao 'TAMANHO DAS MAIORES TABELAS'
psql_q "SELECT schemaname || '.' || relname || ' | ' || pg_size_pretty(pg_total_relation_size(relid))
          FROM pg_catalog.pg_statio_user_tables
         ORDER BY pg_total_relation_size(relid) DESC LIMIT 15"

secao 'CONTAGEM DE LINHAS NAS TABELAS QUE IMPORTAM'
# `users` e a ponte entre os tres servicos. As outras lastreiam dinheiro.
for t in public.users public.push_tokens public.cashback_entries public.integration_settings \
         public.service_api_keys opendriver.driver_earnings opendriver.payout_requests \
         opendriver.rides; do
  n=$(psql_q "SELECT count(*) FROM $t" 2>/dev/null)
  case "$n" in
    ''|*ERROR*|*does\ not\ exist*) echo "$t | TABELA NAO EXISTE" ;;
    *) echo "$t | $n" ;;
  esac
done

secao 'CONFIGURACAO DAS APLICACOES (segredos mascarados)'
for c in $(docker ps --format '{{.Names}}'); do
  env_out=$(docker exec "$c" printenv 2>/dev/null \
    | grep -E '^(PAYMENT_PROVIDER|VEHICLE_VALIDATION_PROVIDER|NODE_ENV|DATABASE_URL|FRONTEND_URL|PORT)=' \
    | sed -E 's#(://[^:]+):[^@]*@#\1:***@#') || true
  if [ -n "$env_out" ]; then
    echo "--- $c"
    echo "$env_out"
  fi
done

secao 'DOMINIOS PUBLICADOS NO TRAEFIK'
docker exec coolify-proxy cat /traefik/dynamic/*.yaml 2>/dev/null | grep -oE 'Host\(`[^`]+`\)' | sort -u \
  || echo '(nao consegui ler a configuracao dinamica do proxy)'

secao 'FIM DO INVENTARIO'
