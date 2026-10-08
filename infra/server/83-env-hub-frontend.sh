#!/usr/bin/env bash
#
# Variaveis de build do hub-frontend, com o valor mascarado.
#
# `VITE_*` e lida em tempo de **build**, nao de execucao: se faltar, o bundle sai com a
# variavel vazia e a tela mostra o aviso de "API nao configurada" — sem erro no servidor,
# sem nada no log. Conferir antes do deploy e mais barato que descobrir depois pela tela.
#
# A tabela `environment_variables` do Coolify e polimorfica (`resourceable_type` +
# `resourceable_id`), nao tem `application_id`. A primeira versao deste script assumiu a
# coluna direta e falhou; o nome da coluna vem do schema, nao de palpite.
set -uo pipefail
UUID="${1:-krqsjubqpzils0nij3atnekp}"

sql() { docker exec coolify-db psql -U coolify -d coolify -At -F '|' -c "$1"; }

echo '--- colunas de environment_variables ---'
# Lista tudo em vez de adivinhar: a primeira versao chutou `application_id` e a segunda
# `is_build_time`; as reais sao `resourceable_id` e `is_buildtime`. Ler o schema custa uma
# consulta e acaba com a adivinhacao.
sql "select string_agg(column_name, ', ' order by ordinal_position)
       from information_schema.columns
      where table_name = 'environment_variables'"

echo '--- valores de resourceable_type presentes ---'
# A comparacao literal falhou porque `App\Models\Application` tem barra simples, e o
# escapamento por bash + psql transformou em barra dupla. `like '%Application'` nao depende
# de acertar o escapamento.
sql "select distinct resourceable_type from environment_variables order by 1"

ID=$(sql "select id from applications where uuid = '$UUID'")
if [ -z "$ID" ]; then
  echo "ABORTADO: aplicacao $UUID nao encontrada" >&2
  exit 1
fi
echo "--- aplicacao $UUID (id $ID) ---"

sql "
  select key,
         case
           when key ~* '(secret|token|password|senha|key)' then '(mascarado, ' || length(value) || ' chars)'
           else value
         end,
         is_buildtime
    from environment_variables
   where resourceable_type like '%Application'
     and resourceable_id = $ID
   order by key" |
  while IFS='|' read -r chave valor build; do
    printf '%-34s build=%-6s %s\n' "$chave" "$build" "$valor"
  done
