#!/usr/bin/env bash
#
# Descobre quais endpoints de Detran da Infosimples existem, **sem gastar consulta**.
#
# A sonda e enviada sem o parametro `token`. A diferenca de resposta e o que interessa:
#
#   endpoint existente  -> HTTP 200 com JSON e `code` de erro de autenticacao (600/601/...)
#   endpoint inexistente-> HTTP 404, normalmente HTML
#
# Por que nao sondar com placa de verdade: a Infosimples cobra por consulta executada. Uma
# varredura de URLs candidatas com token valido poderia gerar cobranca por cada acerto. Sem
# token, nenhuma consulta e executada e a existencia do caminho fica provada do mesmo jeito.
#
# Uso:  bash 78-sondar-endpoints-detran.sh
set -u

BASE='https://api.infosimples.com/api/v2/consultas'

# Candidatos: os dois que ja usamos, mais as variacoes plausiveis de nome para GO e DF, mais
# a consulta unificada.
CANDIDATOS="
detran/mt/veiculo
detran/ms/veiculo
detran/go/veiculo
detran/df/veiculo
detran/df/veiculo-mobile
detran/df/veiculo_mobile
detran/df/veiculo-app
detran/restricoes
"

printf '%-34s %-6s %-9s %s\n' 'ENDPOINT' 'HTTP' 'CODE' 'MENSAGEM'
printf '%-34s %-6s %-9s %s\n' '----------------------------------' '------' '---------' '--------'

for c in $CANDIDATOS; do
  [ -z "$c" ] && continue
  corpo=$(curl -s -m 25 -w '\n@@HTTP@@%{http_code}' \
    -X POST "$BASE/$c" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data 'placa=AAA0A00&renavam=00000000000' 2>/dev/null)

  http=$(printf '%s' "$corpo" | sed -n 's/.*@@HTTP@@\([0-9]*\)$/\1/p')
  json=$(printf '%s' "$corpo" | sed 's/@@HTTP@@[0-9]*$//')

  code=$(printf '%s' "$json" | sed -n 's/.*"code"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  msg=$(printf '%s' "$json" | sed -n 's/.*"code_message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

  if [ -z "${code:-}" ]; then
    # Sem JSON: provavelmente HTML de 404. Mostra o inicio para nao esconder a causa.
    msg=$(printf '%s' "$json" | tr -d '\n' | cut -c1-60)
    code='-'
  fi

  printf '%-34s %-6s %-9s %s\n' "$c" "${http:-?}" "$code" "${msg:-}"
done

echo
echo 'Leitura: HTTP 200 com code de erro de token = endpoint EXISTE e aceita os parametros'
echo 'enviados. HTTP 404 = caminho inexistente. Erro citando parametro obrigatorio ausente'
echo '(chassi, login, cpf) tambem prova que o endpoint existe, e diz o que ele exige.'
