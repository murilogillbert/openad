#!/usr/bin/env bash
#
# Verificação fim a fim do ecossistema, atravessando os três serviços com dado real.
#
# O que esta verificação prova, que o smoke do `22` não prova:
#
#   1. Um token **emitido pelo hub** autentica nas rotas `/advertiser/*` do openad. Essa é a
#      premissa inteira do ecossistema: uma conta, três serviços. Se o `JWT_SECRET`, o
#      `issuer` ou o `audience` divergirem entre os dois, o sintoma aparece só aqui — e, em
#      produção, apareceria como "token inválido" na tela de login do app do anunciante, sem
#      nada no log que aponte a causa.
#   2. A adesão ao openad funciona e é idempotente. Nenhum código criava linha em
#      `openad.ad_advertisers`, de modo que todo anunciante recebia 401 para sempre.
#   3. O openad consegue creditar repasse em `opendriver.driver_earnings`, com a chave de
#      serviço, e **não** paga duas vezes o mesmo `referenceId`.
#
# O token é assinado dentro do contêiner do hub, com o `jsonwebtoken` e o `JWT_SECRET` dele,
# reproduzindo exatamente as claims de `issueTokens`. Assinar aqui com um segredo copiado
# provaria menos: o que está em teste é justamente os dois lados concordarem.
#
# LIMPEZA: tudo o que este script cria em dado de negócio é removido no fim — a linha de
# `ad_advertisers` e o lançamento em `driver_earnings`. O que sobra é o que já existia.
set -uo pipefail

PG='l5bcr9slmgtmeefkqwg5amia'
HUB_API='v6q66q2lv00ly550hffog7f5-000642067238'
OD_API='cag0pegfzuz1zfhkxgjsfzf2-000753239468'
API='openad-api'
ENVF=/root/openad/.env
BASE='http://127.0.0.1:3000/api/v1'

falhas=0
ok()     { printf '  ok      %s\n' "$1"; }
falhou() { printf '  FALHOU  %s\n' "$1"; falhas=$((falhas + 1)); }
secao()  { printf '\n========== %s ==========\n' "$1"; }

# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

psql() { docker exec -i "$PG" psql -U postgres -d hub -At -c "$1"; }

# ---------------------------------------------------------------- escolher as cobaias
secao 'ESCOLHENDO CONTAS REAIS'

# Um usuário qualquer do hub para fazer o papel de anunciante. Exclui quem já é anunciante,
# para que o teste de "precisa aderir" valha, e quem é motorista, para não confundir os dois
# papéis no mesmo teste.
USUARIO=$(psql "
  select u.id || '|' || u.name || '|' || u.email
  from public.users u
  left join openad.ad_advertisers a on a.user_id = u.id
  where a.id is null and u.role <> 'Driver'
  order by u.created_at
  limit 1;")
UID_HUB=${USUARIO%%|*}
resto=${USUARIO#*|}
NOME=${resto%%|*}
EMAIL=${resto#*|}

if [ -z "$UID_HUB" ]; then
  falhou 'nenhum usuario do hub disponivel para o teste'
  exit 1
fi
echo "  anunciante de teste: $NOME <$EMAIL> ($UID_HUB)"

# Um motorista de verdade para o repasse. `creditAdRevenue` consulta `public.users` e recusa
# quem não existe.
MOTORISTA=$(psql "
  select id || '|' || name from public.users where role = 'Driver' order by created_at limit 1;")
UID_DRIVER=${MOTORISTA%%|*}
NOME_DRIVER=${MOTORISTA#*|}
echo "  motorista de teste:  $NOME_DRIVER ($UID_DRIVER)"

# ---------------------------------------------------------------- token do hub
secao 'TOKEN EMITIDO PELO HUB'

# Assinado dentro do contêiner do hub, com o segredo e as claims dele. `issuer` e `audience`
# são constantes em `hub/backend/src/config.ts` (`opendriverhub` nos dois), e é exatamente o
# que `FederatedJwtStrategy`/`EcosystemJwtStrategy` exigem.
TOKEN=$(docker exec \
  -e SUB="$UID_HUB" -e NOME="$NOME" -e EMAIL="$EMAIL" \
  "$HUB_API" node -e '
const jwt = require("jsonwebtoken");
const segredo = process.env.JWT_SECRET;
if (!segredo) { process.stderr.write("sem JWT_SECRET no hub"); process.exit(1); }
process.stdout.write(jwt.sign(
  {
    sub: process.env.SUB,
    name: process.env.NOME,
    email: process.env.EMAIL,
    role: "Client",
  },
  segredo,
  { issuer: "opendriverhub", audience: "opendriverhub", expiresIn: 900, algorithm: "HS256" }
));' 2>/dev/null)

if [ -n "$TOKEN" ]; then ok "token do hub emitido (${#TOKEN} caracteres)"; else falhou 'nao consegui emitir token no hub'; exit 1; fi

# Helper: chama o openad com o token do hub e devolve "corpo\n__status__NNN".
chamar() {
  local metodo="$1" caminho="$2" corpo="${3:-}"
  if [ -n "$corpo" ]; then
    docker exec "$API" curl -s -o /dev/stdout -w '\n__status__%{http_code}' \
      -X "$metodo" -H "Authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' -d "$corpo" "$BASE$caminho"
  else
    docker exec "$API" curl -s -o /dev/stdout -w '\n__status__%{http_code}' \
      -X "$metodo" -H "Authorization: Bearer $TOKEN" "$BASE$caminho"
  fi
}
status_de() { printf '%s' "$1" | sed -n 's/.*__status__\([0-9]*\)$/\1/p'; }
corpo_de()  { printf '%s' "$1" | sed 's/__status__[0-9]*$//'; }

# ---------------------------------------------------------------- antes da adesao
secao 'ANTES DA ADESAO'

r=$(chamar GET /advertiser/onboarding)
st=$(status_de "$r"); c=$(corpo_de "$r")
echo "  $c"
if [ "$st" = '200' ]; then
  ok 'GET /advertiser/onboarding -> 200 (token do hub aceito)'
else
  falhou "GET /advertiser/onboarding -> $st"
fi
case "$c" in
  *'"precisaAderir":true'*) ok 'diz que precisa aderir' ;;
  *) falhou 'esperava precisaAderir=true' ;;
esac

# A verificação que importa: sem linha em `ad_advertisers`, a rota de campanha recusa.
r=$(chamar GET /advertiser/campaigns)
st=$(status_de "$r")
if [ "$st" = '401' ]; then
  ok 'GET /advertiser/campaigns -> 401 antes de aderir'
else
  falhou "GET /advertiser/campaigns -> $st (esperado 401 antes de aderir)"
fi

# ---------------------------------------------------------------- adesao
secao 'ADESAO'

r=$(chamar POST /advertiser/onboarding '{"legalName":"Teste Fim A Fim ME"}')
st=$(status_de "$r"); c=$(corpo_de "$r")
echo "  $c"
if [ "$st" = '200' ]; then ok 'POST /advertiser/onboarding -> 200'; else falhou "POST /advertiser/onboarding -> $st"; fi
case "$c" in
  *'"criado":true'*) ok 'criou o vinculo' ;;
  *) falhou 'esperava criado=true' ;;
esac

# Idempotência: a segunda chamada não pode criar outra linha nem dar erro.
r=$(chamar POST /advertiser/onboarding '{"legalName":"Teste Fim A Fim ME"}')
st=$(status_de "$r"); c=$(corpo_de "$r")
if [ "$st" = '200' ]; then
  case "$c" in
    *'"criado":false'*) ok 'repetir a adesao -> 200 com criado=false (idempotente)' ;;
    *) falhou "repetir a adesao devolveu: $c" ;;
  esac
else
  falhou "repetir a adesao -> $st"
fi

n=$(psql "select count(*) from openad.ad_advertisers where user_id = '$UID_HUB';")
if [ "$n" = '1' ]; then ok 'exatamente 1 linha em ad_advertisers'; else falhou "ad_advertisers tem $n linha(s) para o usuario"; fi

# ---------------------------------------------------------------- depois da adesao
secao 'DEPOIS DA ADESAO'

for caminho in '/advertiser/campaigns' '/advertiser/inventory/zones'; do
  r=$(chamar GET "$caminho")
  st=$(status_de "$r")
  if [ "$st" = '200' ]; then
    ok "GET $caminho -> 200"
  else
    falhou "GET $caminho -> $st"
    corpo_de "$r" | head -c 300; echo
  fi
done

# ---------------------------------------------------------------- repasse ao motorista
secao 'REPASSE AO MOTORISTA (openad -> opendriver)'

REF="e2e-$(date +%s)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PAYLOAD=$(printf '{"driverUserId":"%s","amountCents":37,"referenceId":"%s","campaignId":"e2e-campanha","description":"Verificacao fim a fim"}' "$UID_DRIVER" "$REF")

creditar() {
  docker exec "$API" curl -s -o /dev/stdout -w '\n__status__%{http_code}' \
    -X POST -H "Authorization: Bearer $ECOSYSTEM_SERVICE_API_KEY" \
    -H 'content-type: application/json' -d "$PAYLOAD" \
    "${OPENDRIVER_API_URL:-http://$OD_API:5100}/internal/driver-earnings/ad-revenue"
}

r=$(creditar); st=$(status_de "$r"); c=$(corpo_de "$r")
echo "  $c"
if [ "$st" = '201' ]; then ok 'primeiro credito -> 201'; else falhou "primeiro credito -> $st"; fi
case "$c" in
  *'"duplicated":false'*) ok 'lancamento novo' ;;
  *) falhou 'esperava duplicated=false no primeiro credito' ;;
esac

# Idempotência do repasse: reprocessar um lote de analytics não pode pagar de novo.
r=$(creditar); st=$(status_de "$r"); c=$(corpo_de "$r")
case "$c" in
  *'"duplicated":true'*) ok 'repetir o credito -> duplicated=true (nao pagou de novo)' ;;
  *) falhou "repetir o credito devolveu: $c" ;;
esac

linha=$(psql "
  select type || '|' || amount::text
  from opendriver.driver_earnings where reference_id = '$REF';")
if [ "$linha" = 'AdRevenue|0.37' ]; then
  ok "driver_earnings gravou AdRevenue de R\$ 0,37 (37 centavos convertidos na fronteira)"
else
  falhou "driver_earnings tem '$linha' (esperado 'AdRevenue|0.37')"
fi

n=$(psql "select count(*) from opendriver.driver_earnings where reference_id = '$REF';")
if [ "$n" = '1' ]; then ok 'exatamente 1 lancamento'; else falhou "$n lancamentos para o mesmo referenceId"; fi

# ---------------------------------------------------------------- bloqueadores de exclusao
secao 'BLOQUEADORES DE EXCLUSAO DE CONTA'

for svc in "openad:$BASE/internal/accounts/$UID_HUB/deletion-blockers" \
           "opendriver:${OPENDRIVER_API_URL:-http://$OD_API:5100}/internal/accounts/$UID_HUB/deletion-blockers"; do
  nome=${svc%%:*}; url=${svc#*:}
  r=$(docker exec "$API" curl -s -o /dev/stdout -w '\n__status__%{http_code}' \
    -H "Authorization: Bearer $ECOSYSTEM_SERVICE_API_KEY" "$url")
  st=$(status_de "$r")
  if [ "$st" = '200' ]; then
    ok "$nome deletion-blockers -> 200: $(corpo_de "$r" | head -c 200)"
  else
    falhou "$nome deletion-blockers -> $st"
  fi
done

# ---------------------------------------------------------------- limpeza
secao 'LIMPEZA'

psql "delete from opendriver.driver_earnings where reference_id = '$REF';" >/dev/null
sobra=$(psql "select count(*) from opendriver.driver_earnings where reference_id = '$REF';")
if [ "$sobra" = '0' ]; then ok 'lancamento de teste removido'; else falhou "sobraram $sobra lancamentos"; fi

psql "delete from openad.ad_advertisers where user_id = '$UID_HUB';" >/dev/null
sobra=$(psql "select count(*) from openad.ad_advertisers where user_id = '$UID_HUB';")
if [ "$sobra" = '0' ]; then ok 'anunciante de teste removido'; else falhou "sobraram $sobra anunciantes"; fi

echo '--- conferindo que nada mais mudou'
psql "select 'users=' || count(*) from public.users;"
psql "select 'driver_earnings=' || count(*) from opendriver.driver_earnings;"
psql "select 'ad_advertisers=' || count(*) from openad.ad_advertisers;"

# ---------------------------------------------------------------- resultado
secao 'RESULTADO'
if [ "$falhas" -eq 0 ]; then
  echo 'TODAS as verificacoes fim a fim passaram'
  exit 0
fi
echo "$falhas verificacao(oes) FALHARAM"
exit 1
