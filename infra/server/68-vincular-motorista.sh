#!/usr/bin/env bash
# Fecha o caminho do dinheiro: veiculo -> tablete -> motorista.
#
# Por que existe como script: sao quatro chamadas que **tem de acontecer na ordem**, e a
# terceira falha com 409 se a segunda nao aconteceu. `vehicles` estava vazia em producao, e a
# consequencia nao era um erro visivel — era `play_records` em zero e repasse em zero, porque
# `recordManifestPlayCommitted` descarta a veiculacao quando o tablete nao tem veiculo
# vinculado, e `analytics-reconciliation` nao credita quando o veiculo nao tem motorista.
#
# Uso:
#   bash 68-vincular-motorista.sh listar
#   bash 68-vincular-motorista.sh vincular <deviceId> <driverUserId> <placa> <marca> <modelo>
set -uo pipefail

ACAO="${1:-listar}"
API='http://127.0.0.1:3000/api/v1'

# ------------------------------------------------------------------ autenticacao
EMAIL=$(grep -E '^SEED_ADMIN_EMAIL=' /root/openad/.env | cut -d= -f2- | tr -d '"'"'"'\r')
SENHA=$(grep -E '^SEED_ADMIN_PASSWORD=' /root/openad/.env | cut -d= -f2- | tr -d '"'"'"'\r')
[ -z "${EMAIL:-}" ] && { echo 'ABORTADO: SEED_ADMIN_EMAIL ausente em /root/openad/.env' >&2; exit 1; }

TOKEN=$(docker exec openad-api node -e "
  fetch('$API/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '$EMAIL', password: '$SENHA' }),
  })
    .then(r => r.json())
    .then(j => {
      // O corpo ja veio em dois formatos nesta base; tentar os dois evita um 401 silencioso.
      const t = j?.data?.accessToken ?? j?.accessToken ?? j?.data?.token ?? j?.token;
      if (!t) { console.error('SEM TOKEN: ' + JSON.stringify(j).slice(0,300)); process.exit(1); }
      console.log(t);
    })
    .catch(e => { console.error('LOGIN FALHOU ' + e.message); process.exit(1); });
" 2>&1 | tail -1)

case "$TOKEN" in
  ey*) : ;;
  *) echo "ABORTADO: login nao devolveu token -> $TOKEN" >&2; exit 1 ;;
esac

chamar() { # metodo caminho [corpo]
  local metodo="$1" caminho="$2" corpo="${3:-}"
  docker exec -e TK="$TOKEN" -e M="$metodo" -e P="$caminho" -e B="$corpo" openad-api node -e "
    const opts = {
      method: process.env.M,
      headers: { Authorization: 'Bearer ' + process.env.TK, 'Content-Type': 'application/json' },
    };
    if (process.env.B) opts.body = process.env.B;
    fetch('$API' + process.env.P, opts)
      .then(async r => { console.log('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 700)); })
      .catch(e => console.log('FALHA ' + e.message));
  " 2>&1 | tail -1
}

if [ "$ACAO" = 'listar' ]; then
  TERMO="${2:-}"
  echo "=== motoristas (do espelho public.users; termo='${TERMO}')"
  chamar GET "/admin/drivers/search?q=${TERMO}"
  echo
  echo '=== aparelhos'
  chamar GET '/devices'
  echo
  echo '=== veiculos'
  chamar GET '/vehicles'
  exit 0
fi

DEVICE="${2:?deviceId}"
DRIVER="${3:?driverUserId}"
PLACA="${4:?placa}"
MARCA="${5:-Generico}"
MODELO="${6:-Sedan}"

echo "=== 1/4 cria o veiculo ($PLACA) ja pareado ao tablete"
# `status` e `operatorId` **nao** vao no corpo: o DTO os recusa (`forbidNonWhitelisted`).
# `status` nasce `active` e `operatorId` vem do token do operador. `pairedDeviceIds` na
# criacao poupa a chamada de pareamento, e reatribui o tablete se ele estava em outro
# veiculo.
chamar POST '/vehicles' "$(printf '{"registrationPlate":"%s","make":"%s","model":"%s","year":2022,"commercialTier":"taxi","pairedDeviceIds":["%s"]}' "$PLACA" "$MARCA" "$MODELO" "$DEVICE")"

echo "=== 2/4 confere o veiculo do aparelho"
chamar GET '/vehicles'

echo "=== 3/4 vincula o motorista ao aparelho"
chamar PUT "/admin/devices/$DEVICE/driver" "$(printf '{"driverUserId":"%s"}' "$DRIVER")"

echo "=== 4/4 confere"
chamar GET "/admin/devices/$DEVICE/driver"
