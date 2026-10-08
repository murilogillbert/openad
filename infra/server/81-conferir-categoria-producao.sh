#!/usr/bin/env bash
#
# Confere, em producao, o que as migrations da categoria de veiculo deixaram.
#
# Separado de `10-migrations-producao.sh` de proposito: aquele prova que a migration rodou e
# que o schema do hub nao foi tocado. Este prova que o **conteudo** esta certo — a carga
# inicial entrou inteira, a frota nao foi reescrita, e a classificacao gravada acerta os
# casos conhecidos. Migration que "rodou sem erro" nao e evidencia de que o dado esta bom.
set -uo pipefail
PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1"; }
secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'TABELAS NOVAS'
q "SELECT table_name FROM information_schema.tables WHERE table_schema='opendriver' AND table_name IN ('detran_providers','vehicle_model_categories') ORDER BY 1"

secao 'COLUNAS NOVAS EM vehicles'
q "SELECT column_name || ' ' || data_type || ' default=' || coalesce(column_default,'(nenhum)') FROM information_schema.columns WHERE table_schema='opendriver' AND table_name='vehicles' AND column_name IN ('category_source','category_auto','category_divergence','detran_brand','detran_model','detran_year') ORDER BY 1"

secao 'A FROTA NAO FOI REESCRITA'
echo "veiculos: $(q 'SELECT count(*) FROM opendriver.vehicles')"
q "SELECT x.k || ' x' || x.n FROM (SELECT category::text || ' / ' || validation_status::text || ' / fonte=' || category_source AS k, count(*) AS n FROM opendriver.vehicles GROUP BY 1) x ORDER BY 1"
echo "--- fora do estado inicial esperado (deve ser 0) ---"
q "SELECT count(*) FROM opendriver.vehicles WHERE category_source <> 'driver' OR category_auto IS NOT NULL OR category_divergence"

secao 'PROVEDORES POR UF'
q "SELECT uf || ' | ativo=' || active || ' | login=' || requires_login || ' | ' || endpoint FROM opendriver.detran_providers ORDER BY uf"

secao 'CARGA INICIAL DAS REGRAS'
q "SELECT count(DISTINCT brand) || ' marcas, ' || count(*) || ' regras' FROM opendriver.vehicle_model_categories"
q "SELECT x.k || ' x' || x.n FROM (SELECT category::text || ' / ' || source AS k, count(*) AS n FROM opendriver.vehicle_model_categories GROUP BY 1) x ORDER BY 1"

secao 'CLASSIFICACAO GRAVADA, CASOS CONHECIDOS'
if [ ! -f /root/openad-infra/79-classificacao.sql ]; then
  echo 'ABORTADO: nao encontrei 79-classificacao.sql no servidor' >&2
  exit 1
fi
# `-i` e obrigatorio quando a entrada vem de stdin; aqui vai por arquivo, que e mais seguro.
docker cp /root/openad-infra/79-classificacao.sql "$PG:/tmp/classificacao.sql" >/dev/null
# As tabelas temporarias do script morrem com a sessao: nada e gravado em producao.
if docker exec "$PG" psql -U postgres -d hub -v ON_ERROR_STOP=1 -f /tmp/classificacao.sql | tail -25; then
  echo 'OK'
else
  echo 'FALHOU: a classificacao em producao nao bate com os casos esperados' >&2
  docker exec "$PG" rm -f /tmp/classificacao.sql
  exit 1
fi
docker exec "$PG" rm -f /tmp/classificacao.sql

secao 'INDICES'
q "SELECT indexname FROM pg_indexes WHERE schemaname='opendriver' AND (tablename IN ('vehicle_model_categories','detran_providers') OR indexname IN ('vehicles_category_divergence_idx','vehicles_validation_status_idx')) ORDER BY 1"

secao 'PROVEDOR DE VALIDACAO EM USO'
# Importa porque, enquanto for `mock`, a consulta ao Detran nao acontece e a classificacao
# trabalha sobre o eco do que o motorista digitou — util para exercitar, inutil para valer.
for c in cag0pegfzuz1zfhkxgjsfzf2 v6q66q2lv00ly550hffog7f5; do
  nome=$(docker ps --filter "name=$c" --format '{{.Names}}' | head -1)
  [ -n "$nome" ] || continue
  valor=$(docker exec "$nome" printenv VEHICLE_VALIDATION_PROVIDER 2>/dev/null || echo '(nao definida -> vale o padrao mock)')
  printf '%-45s VEHICLE_VALIDATION_PROVIDER=%s\n' "$nome" "$valor"
done
echo "--- token da Infosimples cadastrado? ---"
q "SELECT CASE WHEN count(*) > 0 THEN 'sim' ELSE 'NAO' END FROM public.integration_settings WHERE key='Infosimples__Token' OR key='Infosimples:Token'"

secao 'CONFERENCIA CONCLUIDA'
