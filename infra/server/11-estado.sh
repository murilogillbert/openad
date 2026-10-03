#!/usr/bin/env bash
# Estado do banco de producao e das migrations. Somente leitura.
#
# Existe porque o quoting aninhado (PowerShell -> ssh -> bash -> docker -> psql) quebra de
# formas diferentes em cada camada; script em arquivo nao tem esse problema.
set -uo pipefail
PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1" 2>&1; }

echo "schemas:               $(q "SELECT string_agg(nspname,',' ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','opendriver','openad')")"
echo "migrations public:     $(q 'SELECT count(*) FROM public._prisma_migrations')"
echo "migrations opendriver: $(q 'SELECT count(*) FROM opendriver._prisma_migrations')"
echo "migrations openad:     $(q 'SELECT count(*) FROM openad._prisma_migrations')"
echo "push_tokens:           $(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='push_tokens'")"
echo "tabelas openad:        $(q "SELECT string_agg(table_name,',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='openad'")"
echo "EarningType:           $(q "SELECT string_agg(e.enumlabel,',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='EarningType'")"
echo "reference_id:          $(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='opendriver' AND table_name='driver_earnings' AND column_name='reference_id'")"
echo "women_only em rides:   $(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='opendriver' AND table_name='rides' AND column_name='women_only'")"
echo "passenger_links:       $(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='opendriver' AND table_name='passenger_links'")"
echo ''
echo '--- ultimas migrations de cada schema ---'
q "SELECT 'public: '||migration_name FROM public._prisma_migrations ORDER BY finished_at DESC NULLS FIRST LIMIT 3"
q "SELECT 'opendriver: '||migration_name FROM opendriver._prisma_migrations ORDER BY finished_at DESC NULLS FIRST LIMIT 4"
echo ''
echo '--- migrations pela metade (vazio = ok) ---'
q "SELECT 'public: '||migration_name FROM public._prisma_migrations WHERE finished_at IS NULL"
q "SELECT 'opendriver: '||migration_name FROM opendriver._prisma_migrations WHERE finished_at IS NULL"
echo ''
echo '--- dados ---'
echo "users:            $(q 'SELECT count(*) FROM public.users')"
echo "cashback_entries: $(q 'SELECT count(*) FROM public.cashback_entries')"
echo "rides:            $(q 'SELECT count(*) FROM opendriver.rides')"
echo "driver_earnings:  $(q 'SELECT count(*) FROM opendriver.driver_earnings')"
echo ''
echo '--- containers no ar ---'
docker ps --format '{{.Names}} | {{.Status}}'
