#!/usr/bin/env bash
# Ensaia as migrations pendentes da v2 no Postgres de ENSAIO (openad-pg-sandbox).
#
# Por que existe: as quatro migrations da v2 mexem em tabelas que tres apps
# publicados leem. Antes de tocar producao a gente aplica na copia e confere o
# que mudou. O script NAO toca em producao: o container esta fixo no codigo.
#
# Uso:
#   bash 81-ensaio-migrations-sandbox.sh estado    # so mostra onde o sandbox esta
#   bash 81-ensaio-migrations-sandbox.sh aplicar   # aplica as 4 e confere
#
# Os arquivos .sql tem de estar em /tmp/v2mig (enviados por scp).

set -uo pipefail

CONTAINER='openad-pg-sandbox'
BANCO='hub'
DIR='/tmp/v2mig'

# Nome do container de PRODUCAO. Se alguem trocar CONTAINER por este valor por
# descuido, o script para. Producao se aplica pelo 10-migrations-producao.sh.
PRODUCAO='l5bcr9slmgtmeefkqwg5amia'

if [ "$CONTAINER" = "$PRODUCAO" ]; then
  echo 'ERRO: este script e so para o sandbox.' >&2
  exit 1
fi

psql_q() {
  docker exec "$CONTAINER" psql -U postgres -d "$BANCO" -At -c "$1" 2>&1
}

titulo() {
  echo
  echo "=============================================================="
  echo "$1"
  echo "=============================================================="
}

estado() {
  titulo 'migrations registradas (ultima de cada schema)'
  for s in openad public opendriver; do
    printf '%-12s %s\n' "$s" "$(psql_q "select migration_name from ${s}._prisma_migrations where finished_at is not null order by finished_at desc limit 1")"
  done

  titulo 'objetos que as migrations da v2 criam'
  printf 'openad.ad_credit_holds        %s\n' "$(psql_q "select to_regclass('openad.ad_credit_holds') is not null")"
  printf 'openad.ad_credit_purchases    %s\n' "$(psql_q "select to_regclass('openad.ad_credit_purchases') is not null")"
  printf 'public.product_store_stock    %s\n' "$(psql_q "select to_regclass('public.product_store_stock') is not null")"
  printf 'partner_stores.opening_hours  %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='opening_hours'")"
  printf 'partner_stores.timezone       %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='timezone'")"
  printf 'partner_stores.active         %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='active'")"
  printf 'order_items.redeemed_store_id %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='redeemed_store_id'")"

  titulo 'versao do Postgres'
  psql_q 'show server_version'

  titulo 'acervo que a migration de avatar vai limpar'
  printf 'users com dicebear            %s\n' "$(psql_q "select count(*) from public.users where avatar_url like '%dicebear%'")"
  printf 'users com ui-avatars          %s\n' "$(psql_q "select count(*) from public.users where avatar_url like '%ui-avatars%'")"
  printf 'users com gravatar            %s\n' "$(psql_q "select count(*) from public.users where avatar_url like '%gravatar%'")"
  printf 'partners com dicebear         %s\n' "$(psql_q "select count(*) from public.partners where logo_url like '%dicebear%'")"

  titulo 'volume das tabelas tocadas'
  for t in users partners products partner_stores order_items; do
    printf '%-12s %s\n' "$t" "$(psql_q "select count(*) from public.${t}")"
  done
}

aplicar() {
  for f in \
    "$DIR/1-openad-ad_credit_holds.sql" \
    "$DIR/2-openad-credito_por_pix.sql" \
    "$DIR/3-hub-estoque_por_unidade.sql" \
    "$DIR/4-hub-sem_avatar.sql"
  do
    if [ ! -f "$f" ]; then
      echo "ERRO: falta $f" >&2
      exit 1
    fi
  done

  # O search_path de cada migration: as do openad referenciam "openad"."..."
  # explicitamente; as do hub usam nomes sem schema e dependem do default.
  for par in \
    "1-openad-ad_credit_holds.sql|openad" \
    "2-openad-credito_por_pix.sql|openad" \
    "3-hub-estoque_por_unidade.sql|public" \
    "4-hub-sem_avatar.sql|public"
  do
    arq="${par%%|*}"
    schema="${par##*|}"
    titulo "aplicando $arq  (search_path=$schema)"
    # -1 roda tudo numa transacao: se qualquer comando falhar, nada fica.
    if docker exec -i "$CONTAINER" psql -U postgres -d "$BANCO" \
         -v ON_ERROR_STOP=1 -1 \
         -c "set search_path to ${schema}" \
         -f - < "$DIR/$arq"
    then
      echo "ok  $arq"
    else
      echo "FALHOU  $arq" >&2
      exit 1
    fi
  done

  titulo 'DEPOIS: conferencia'
  printf 'openad.ad_credit_holds        %s\n' "$(psql_q "select to_regclass('openad.ad_credit_holds') is not null")"
  printf 'openad.ad_credit_purchases    %s\n' "$(psql_q "select to_regclass('openad.ad_credit_purchases') is not null")"
  printf 'public.product_store_stock    %s\n' "$(psql_q "select to_regclass('public.product_store_stock') is not null")"
  printf 'partner_stores.opening_hours  %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='opening_hours'")"
  printf 'partner_stores.timezone       %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='timezone'")"
  printf 'partner_stores.active         %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='partner_stores' and column_name='active'")"
  printf 'order_items.redeemed_store_id %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='redeemed_store_id'")"
  printf 'ad_credit_purchases.credit_micros %s\n' "$(psql_q "select count(*)>0 from information_schema.columns where table_schema='openad' and table_name='ad_credit_purchases' and column_name='credit_micros'")"
  printf 'ad_credit_purchases.product_sku anulavel %s\n' "$(psql_q "select is_nullable from information_schema.columns where table_schema='openad' and table_name='ad_credit_purchases' and column_name='product_sku'")"

  titulo 'avatares de terceiro que sobraram (tem de ser 0)'
  printf 'users                         %s\n' "$(psql_q "select count(*) from public.users where avatar_url like '%dicebear%' or avatar_url like '%ui-avatars%' or avatar_url like '%gravatar%'")"
  printf 'partners                      %s\n' "$(psql_q "select count(*) from public.partners where logo_url like '%dicebear%' or logo_url like '%ui-avatars%' or logo_url like '%gravatar%'")"

  titulo 'chaves estrangeiras de product_store_stock'
  psql_q "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.product_store_stock'::regclass order by conname"

  titulo 'valores do enum AdStore (se existir)'
  psql_q "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='AdStore' order by e.enumsortorder"

  titulo 'nenhum produto perdeu disponibilidade por falta de linha'
  printf 'produtos sem linha em product_store_stock  %s\n' "$(psql_q "select count(*) from public.products p where not exists (select 1 from public.product_store_stock s where s.product_id=p.id)")"
  echo '(esses continuam disponiveis em todas as unidades: declared=false)'
}

case "${1:-estado}" in
  estado)  estado ;;
  aplicar) estado; aplicar ;;
  *) echo "uso: $0 [estado|aplicar]" >&2; exit 1 ;;
esac
