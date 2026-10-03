#!/usr/bin/env bash
# Confere, nas duas APIs, se as páginas legais identificam o controlador — e, se não
# identificarem, de onde vem o valor errado.
#
# O defeito que isto pega: `LEGAL_COMPANY` definida no Coolify **sobrescreve** o padrão do
# código. O padrão foi corrigido para a razão social real justamente porque a variável não
# estava definida; se ela passar a estar definida com o valor antigo, a página volta a não
# identificar pessoa jurídica nenhuma, e nada no código mostra isso.
set -uo pipefail

secao() { printf '\n========== %s ==========\n' "$1"; }

conteiner() {
  docker ps --format '{{.Names}}' | grep "^$1" | head -1
}

HUB=$(conteiner 'v6q66q2lv00ly550hffog7f5')
OD=$(conteiner 'cag0pegfzuz1zfhkxgjsfzf2')

secao 'VARIAVEIS LEGAL_* NOS CONTEINERES'
for par in "hub-backend:$HUB" "opendriver-backend:$OD"; do
  nome=${par%%:*}; c=${par#*:}
  echo "--- $nome ($c)"
  docker exec "$c" printenv | grep -i '^LEGAL' || echo '  (nenhuma definida — usa o padrao do codigo)'
done

secao 'O QUE O COOLIFY GUARDA'
docker exec coolify-db psql -U coolify -d coolify -A -F '|' -c "
  select a.name, e.key, e.value
  from environment_variables e
  join applications a on a.id = e.resourceable_id and e.resourceable_type like '%Application%'
  where e.key like 'LEGAL%'
  order by a.name, e.key;" 2>&1 | head -20

secao 'CONTEUDO SERVIDO'
for url in 'https://hubapi.opendriver.com.br/legal/privacidade' \
           'https://hubapi.opendriver.com.br/legal/termos' \
           'https://api-app.opendriver.com.br/legal/privacidade' \
           'https://api-app.opendriver.com.br/legal/termos' \
           'https://adsapi.opendriver.com.br/legal/privacidade' \
           'https://adsapi.opendriver.com.br/legal/termos'; do
  corpo=$(curl -s --max-time 20 "$url" 2>/dev/null)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null)
  razao='NAO'
  cnpj='NAO'
  printf '%s' "$corpo" | grep -q 'Heavenbound Systems LTDA' && razao='ok'
  printf '%s' "$corpo" | grep -q '51.574.461/0001-09' && cnpj='ok'
  printf '  %-54s %s  razao=%-3s cnpj=%s\n' "$url" "$code" "$razao" "$cnpj"

  # Se a razão social não aparece, mostra o que aparece no lugar.
  if [ "$razao" = 'NAO' ] && [ "$code" = '200' ]; then
    encontrado=$(printf '%s' "$corpo" | grep -o 'oferecido por [^.<]*\|como [A-Z][^(]*(\"n[oó]s\")' | head -1)
    [ -n "$encontrado" ] && printf '      no lugar: %s\n' "$encontrado"
  fi
done
