#!/usr/bin/env bash
#
# Levanta o estado real das integracoes que decidem se dinheiro entra e se veiculo e validado.
#
# Por que existe: o plano da v2 parte de duas suposicoes que eu nao havia verificado em
# execucao — se `PAYMENT_PROVIDER` esta em `mock` em producao, e se as credenciais do Asaas e
# da Infosimples estao em `integration_settings`. A diferenca entre as duas respostas muda a
# prioridade da primeira frente inteira, e no caso do pagamento pode significar que pedidos
# estao sendo marcados como pagos sem cobranca nenhuma.
#
# Nao imprime valor de segredo: so se existe, de onde vem e o tamanho.
set -u

PG_CONTAINER='l5bcr9slmgtmeefkqwg5amia'
PG_DB='hub'
PG_USER='postgres'

secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'VARIAVEIS DE AMBIENTE DOS BACKENDS'
for uuid in v6q66q2lv00ly550hffog7f5 cag0pegfzuz1zfhkxgjsfzf2; do
  nome=$(docker ps --format '{{.Names}}' | grep "^${uuid}" | head -1)
  if [ -z "${nome:-}" ]; then
    echo "  ${uuid}: container nao esta rodando"
    continue
  fi
  rotulo=$(docker exec coolify-db psql -U coolify -d coolify -At -c \
    "select name from applications where uuid = '${uuid}';" 2>/dev/null | tr -d '\r')
  echo "-- ${rotulo:-$uuid}  ($nome)"
  docker exec "$nome" printenv 2>/dev/null |
    grep -E '^(PAYMENT_PROVIDER|PAYMENT_WEBHOOK_REQUIRE_TOKEN|VEHICLE_VALIDATION_PROVIDER)=' |
    sed 's/^/     /' || true
  # Ausencia importa tanto quanto presenca: sem a variavel, vale o default do codigo.
  for v in PAYMENT_PROVIDER VEHICLE_VALIDATION_PROVIDER; do
    if ! docker exec "$nome" printenv "$v" >/dev/null 2>&1; then
      echo "     $v= (NAO DEFINIDA -> vale o default do codigo)"
    fi
  done
done

secao 'CREDENCIAIS EM integration_settings (sem mostrar valor)'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -A -F '|' -c "
  select key,
         length(value) as tamanho,
         case when coalesce(trim(value), '') = '' then 'VAZIO' else 'preenchido' end as estado,
         updated_at
    from public.integration_settings
   where key like 'Asaas:%'
      or key like 'Infosimples:%'
      or key like 'OpenDriver:%'
      or key like 'OpenAd:%'
      or key like 'Internal:%'
   order by key;
" 2>/dev/null || echo '  nao consegui consultar integration_settings'

secao 'O QUE AINDA NAO TEM LINHA NENHUMA'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c "
  with esperadas(key) as (values
    ('Asaas:ApiKey'), ('Asaas:WebhookToken'), ('Asaas:Environment'),
    ('Infosimples:Token'),
    ('OpenAd:ApiUrl'), ('OpenAd:EarningKey'),
    ('Internal:AccountSyncKey')
  )
  select e.key
    from esperadas e
    left join public.integration_settings i on i.key = e.key
   where i.key is null
   order by e.key;
" 2>/dev/null | sed 's/^/  ausente: /' || true

secao 'IMPACTO: PEDIDOS E PAGAMENTOS JA REGISTRADOS'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -A -F '|' -c "
  select provider, status, count(*) as qtd, min(created_at) as primeiro, max(created_at) as ultimo
    from public.payments
   group by provider, status
   order by qtd desc
   limit 20;
" 2>/dev/null || echo '  (tabela public.payments nao encontrada com esse nome)'

secao 'PAGAMENTOS DE CORRIDA NO OPENDRIVER'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -A -F '|' -c "
  select provider, status, count(*) as qtd, max(created_at) as ultimo
    from opendriver.ride_payments
   group by provider, status
   order by qtd desc
   limit 20;
" 2>/dev/null || echo '  (tabela opendriver.ride_payments nao encontrada)'

secao 'VEICULOS E CATEGORIA'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -A -F '|' -c "
  select category, status, validation_status, count(*) as qtd
    from opendriver.vehicles
   group by category, status, validation_status
   order by qtd desc;
" 2>/dev/null || echo '  (tabela opendriver.vehicles nao encontrada)'

secao 'CREDITO DE ANUNCIANTE'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -A -F '|' -c "
  select
    (select count(*) from openad.ad_advertisers)      as anunciantes,
    (select count(*) from openad.ad_credit_purchases) as compras,
    (select count(*) from openad.ad_credit_ledger)    as lancamentos;
" 2>/dev/null || echo '  (schema openad nao encontrado)'
