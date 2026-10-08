#!/usr/bin/env bash
#
# Conferencia **somente leitura** do que as quatro migrations da v2 deixaram em producao.
#
# Por que nao basta o relatorio do `10-migrations-producao.sh`: a secao "--- criado ---" dele
# saiu vazia nesta execucao. Nao porque nada foi criado, mas porque o grep exige que a linha
# do diff comece em `> CREATE` e o `pg_dump` poe um bloco de comentario antes de cada objeto.
# E um defeito de relatorio, e relatorio que cala quando devia falar e exatamente o que faz
# alguem concluir "nao criou nada" de um banco onde criou.
#
# Aqui a pergunta e feita ao catalogo do Postgres, nao ao diff.
#
# Uso:  bash 90-conferir-v2-producao.sh
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"

q() { docker exec "$PG" psql -U "$PG_USER" -d hub -At -c "$1" 2>&1; }

titulo() { printf '\n========== %s ==========\n' "$1"; }

titulo 'historico de migrations'
for s in public opendriver openad; do
  printf '%-12s %s (%s aplicadas)\n' "$s" \
    "$(q "select migration_name from ${s}._prisma_migrations where finished_at is not null order by finished_at desc limit 1")" \
    "$(q "select count(*) from ${s}._prisma_migrations where finished_at is not null")"
done

titulo 'nenhuma migration pela metade'
q "select 'public: '||migration_name from public._prisma_migrations where finished_at is null
   union all select 'opendriver: '||migration_name from opendriver._prisma_migrations where finished_at is null
   union all select 'openad: '||migration_name from openad._prisma_migrations where finished_at is null"
echo '(vazio acima = tudo concluido)'

titulo 'objetos criados pela v2'
printf 'openad.ad_credit_holds              %s\n' "$(q "select to_regclass('openad.ad_credit_holds') is not null")"
printf 'public.product_store_stock          %s\n' "$(q "select to_regclass('public.product_store_stock') is not null")"
printf 'partner_stores.opening_hours        %s\n' "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='opening_hours'")"
printf 'partner_stores.timezone             %s\n' "$(q "select column_default from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='timezone'")"
printf 'partner_stores.active               %s\n' "$(q "select column_default from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='active'")"
printf 'order_items.redeemed_store_id       %s\n' "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='redeemed_store_id'")"
printf 'ad_credit_ledger.reference_id       %s\n' "$(q "select data_type from information_schema.columns where table_schema='openad' and table_name='ad_credit_ledger' and column_name='reference_id'")"
printf 'ad_credit_ledger.amount_micros      %s\n' "$(q "select data_type from information_schema.columns where table_schema='openad' and table_name='ad_credit_ledger' and column_name='amount_micros'")"
printf 'ad_credit_ledger.hold_id            %s\n' "$(q "select data_type from information_schema.columns where table_schema='openad' and table_name='ad_credit_ledger' and column_name='hold_id'")"
printf 'ad_credit_purchases.credit_micros   %s\n' "$(q "select data_type from information_schema.columns where table_schema='openad' and table_name='ad_credit_purchases' and column_name='credit_micros'")"
printf 'ad_credit_purchases.product_sku     anulavel=%s\n' "$(q "select is_nullable from information_schema.columns where table_schema='openad' and table_name='ad_credit_purchases' and column_name='product_sku'")"

titulo 'enum AdStore'
q "select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where t.typname='AdStore' and n.nspname='openad'"

titulo 'chaves e indices de product_store_stock'
q "select conname||' | '||pg_get_constraintdef(oid) from pg_constraint where conrelid='public.product_store_stock'::regclass order by conname"
q "select indexname from pg_indexes where schemaname='public' and tablename='product_store_stock' order by 1"

titulo 'avatares de terceiro (tem de ser 0 nos dois)'
printf 'users     %s\n' "$(q "select count(*) from public.users where avatar_url like '%dicebear%' or avatar_url like '%ui-avatars%' or avatar_url like '%gravatar%'")"
printf 'partners  %s\n' "$(q "select count(*) from public.partners where logo_url like '%dicebear%' or logo_url like '%ui-avatars%' or logo_url like '%gravatar%'")"

titulo 'nada perdeu disponibilidade'
# Produto sem linha em product_store_stock continua disponivel em TODAS as unidades
# (declared=false). A conferencia existe para a contagem casar com o total de produtos: se
# casasse parcialmente, alguem teria escrito linha parcial e metade do catalogo sumiria.
printf 'produtos no total                      %s\n' "$(q "select count(*) from public.products")"
printf 'produtos sem linha de disponibilidade  %s\n' "$(q "select count(*) from public.products p where not exists (select 1 from public.product_store_stock s where s.product_id=p.id)")"
printf 'unidades no total                      %s\n' "$(q "select count(*) from public.partner_stores")"
printf 'unidades sem horario declarado         %s\n' "$(q "select count(*) from public.partner_stores where opening_hours is null")"
echo '(as duas colunas "sem" devem bater com o total: nenhuma declaracao foi inventada)'

titulo 'dados preservados'
for t in 'public.users' 'public.partners' 'public.products' 'public.orders' 'public.cashback_entries' 'opendriver.rides' 'opendriver.driver_earnings'; do
  printf '%-28s %s\n' "$t" "$(q "select count(*) from ${t}")"
done
