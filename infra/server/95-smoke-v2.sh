#!/usr/bin/env bash
#
# Smoke das rotas e das telas que a leva v2 introduziu, contra producao.
#
# O que este smoke afirma e o que ele NAO afirma.
#
# Afirma: a rota existe (nao responde 404), exige autenticacao (responde 401 ou 403 sem
# credencial) e, nas rotas internas, aceita a chave de servico nova. Isso cobre a falha mais
# comum de deploy: codigo novo que nao subiu, ou subiu e nao foi registrado no roteador.
#
# NAO afirma que o fluxo de pagamento funciona ponta a ponta — o token do Asaas nao esta
# configurado, e sem ele a cobranca Pix responde 503 por desenho.
#
# O par 404/401 e o criterio central, e e assim de proposito: `404` numa rota que deveria
# existir e deploy atrasado; `200` numa rota que deveria exigir credencial e falha de
# autorizacao. As duas sao graves e tem sintomas opostos, entao conferir so "respondeu" nao
# serve.
#
# Uso:  bash 95-smoke-v2.sh
set -uo pipefail

ADS='https://adsapi.opendriver.com.br/api/v1'
HUB='https://hubapi.opendriver.com.br/api/v1'
PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"

falhas=0
titulo() { printf '\n========== %s ==========\n' "$1"; }

# $1 rotulo  $2 metodo  $3 url  $4 codigos aceitos (lista separada por espaco)  $5.. extra curl
checar() {
  local rotulo="$1" metodo="$2" url="$3" aceitos="$4"; shift 4
  local codigo
  codigo="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X "$metodo" "$@" "$url")"
  local ok=0
  for a in $aceitos; do [ "$codigo" = "$a" ] && ok=1; done
  if [ "$ok" = 1 ]; then
    printf '  ok     %-46s %s\n' "$rotulo" "$codigo"
  else
    printf '  FALHOU %-46s %s (esperado: %s)\n' "$rotulo" "$codigo" "$aceitos"
    falhas=$((falhas + 1))
  fi
}

titulo 'Frente A: credito de veiculacao no app do anunciante'
# Sem token: 401. Se der 404, o openad-api nao tem o codigo novo.
checar 'GET  /advertiser/credits/balance'   GET  "$ADS/advertiser/credits/balance"   401
checar 'GET  /advertiser/credits/ledger'    GET  "$ADS/advertiser/credits/ledger"    401
checar 'GET  /advertiser/credits/pricing'   GET  "$ADS/advertiser/credits/pricing"   401
checar 'GET  /advertiser/credits/purchases' GET  "$ADS/advertiser/credits/purchases" 401
checar 'POST /advertiser/credits/pix'       POST "$ADS/advertiser/credits/pix"       401

titulo 'Frente A: rotas internas (chave de servico, nao JWT)'
# Sem chave: 401. Com chave de escopo errado seria 403 — os dois provam que a rota existe.
checar 'POST /internal/ads/credits/:id/confirm' POST "$ADS/internal/ads/credits/00000000-0000-0000-0000-000000000000/confirm" 401
checar 'POST /internal/ads/credits/:id/refund'  POST "$ADS/internal/ads/credits/00000000-0000-0000-0000-000000000000/refund"  401
checar 'POST /internal/ads/credits/adjust'      POST "$ADS/internal/ads/credits/adjust"      401
checar 'POST /internal/ads/credit-charges (hub)' POST "$HUB/internal/ads/credit-charges"     401

titulo 'rota interna aceita a chave nova (escopo ads:credit:write)'
# Le a chave do proprio banco: e a mesma que o hub usa, e nao ha segunda copia em script.
CHAVE="$(docker exec "$PG" psql -U postgres -d hub -At -c \
  "select value from public.integration_settings where key='Internal:AccountSyncKey'")"
if [ -z "$CHAVE" ]; then
  echo '  FALHOU nao achei Internal:AccountSyncKey'
  falhas=$((falhas + 1))
else
  # `Authorization: Bearer`, nao `x-api-key`.
  #
  # A primeira versao deste smoke usou `x-api-key` e levou 401 — e eu quase registrei isso
  # como falha do deploy. O contrato dos tres servicos e `Authorization: Bearer <chave>`
  # (`service-api-key.guard.ts` do openad, `infra/auth/apiKey.ts` do hub,
  # `middleware/apiKey.ts` do opendriver). Conferencia com o cabecalho errado produz
  # exatamente o sintoma que ela deveria detectar, e e assim que se "conserta" o que nao
  # esta quebrado.
  #
  # Compra inexistente com chave valida: 400/404/422 prova que passou da autorizacao e chegou
  # na regra de negocio. `401` ou `403` aqui significaria chave ou escopo errados — que e o
  # que esta rotacao existia para consertar.
  checar 'POST confirm com chave valida -> passa do 401' POST \
    "$ADS/internal/ads/credits/00000000-0000-0000-0000-000000000000/confirm" '400 404 422' \
    -H "Authorization: Bearer $CHAVE" -H 'content-type: application/json' \
    -d '{"transactionId":"smoke","paidAmountCents":100}'

  # O escopo de cobranca vai na direcao oposta (openad -> hub), e a chave e a mesma. Conferir
  # so um dos dois sentidos deixaria metade da Frente A sem cobertura.
  checar 'POST credit-charges no hub -> passa do 401' POST \
    "$HUB/internal/ads/credit-charges" '400 422 503' \
    -H "Authorization: Bearer $CHAVE" -H 'content-type: application/json' \
    -d '{}'
fi

titulo 'Frente D: catalogo com unidade e horario'
checar 'GET  /products (hub, exige sessao)'   GET  "$HUB/products"        '401 200'
checar 'GET  /partner/stores'                 GET  "$HUB/partner/stores"  401

titulo 'Frente F: rota de arquivo do criativo'
# Sem `exp`+`sig` e sem JWT: 401.
#
# Este caso achou um defeito de verdade no smoke de 2026-10-08: respondia **500**, porque o
# `AssetDownloadGuard` estendia `AuthGuard('jwt')` e nao existe estrategia passport com esse
# nome neste servico (sao `jwt-internal` e `jwt-federated`). O caminho de JWT da guarda nunca
# funcionou, e pedido sem credencial saia como erro de servidor em vez de "nao autenticado" —
# que num painel de monitoracao manda procurar no lugar errado.
checar 'GET  /campaigns/:id/assets/:id/file sem credencial' GET \
  "$ADS/campaigns/000000000000000000000000/assets/000000000000000000000000/file" '401 403 404'

# Assinatura invalida tambem e 401, nao 500: e o caminho que um aparelho com URL vencida
# percorre, e ele precisa ser distinguivel de queda do servico.
checar 'GET  ...file com assinatura invalida' GET \
  "$ADS/campaigns/000000000000000000000000/assets/000000000000000000000000/file?exp=9999999999&sig=invalida" \
  '401 403'

titulo 'saude dos servicos'
checar 'openad-api  /api/health'  GET 'https://adsapi.opendriver.com.br/api/health'  200
checar 'hub-backend /api/v1/health' GET "$HUB/health" '200 404'
checar 'painel do hub'            GET 'https://hub.opendriver.com.br/'               200

titulo 'estado do banco depois do deploy'
q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1"; }
printf 'ad_credit_holds existe        %s\n' "$(q "select to_regclass('openad.ad_credit_holds') is not null")"
printf 'lancamentos no ledger         %s\n' "$(q 'select count(*) from openad.ad_credit_ledger')"
printf 'reservas de credito           %s\n' "$(q 'select count(*) from openad.ad_credit_holds')"
printf 'compras de credito            %s\n' "$(q 'select count(*) from openad.ad_credit_purchases')"
printf 'anunciantes                   %s\n' "$(q 'select count(*) from openad.ad_advertisers')"

titulo 'RESULTADO'
if [ "$falhas" = 0 ]; then
  echo 'todas as conferencias passaram'
else
  echo "$falhas conferencia(s) reprovada(s)"
  exit 1
fi
