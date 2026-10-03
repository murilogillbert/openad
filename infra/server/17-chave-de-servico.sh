#!/usr/bin/env bash
#
# Cria a chave de serviço do ecossistema em `public.service_api_keys` e a distribui.
#
# Faz exatamente o que a tela Admin → Chaves de API do hub faz
# (`hub/backend/src/services/serviceApiKeyService.ts`): gera 32 bytes aleatórios com prefixo
# `odh_svc_`, grava **só o hash SHA-256** e um `key_preview`, e devolve o texto puro uma única
# vez. Inserir a linha por SQL é legítimo — a regra do ecossistema é que só o dono altera a
# **estrutura** do seu schema; gravar dado é o que a própria interface do hub faz.
#
# Idempotente pelo `label`: se a chave já existe, não cria outra. Duas chaves válidas para a
# mesma função dobram a superfície sem benefício, e a segunda nunca é revogada porque ninguém
# lembra que existe.
#
# Escopos, e por que cada um:
#   account:read / account:purge  -> fan-out de exclusão de conta (hub -> opendriver, openad)
#   ads:earning:write             -> openad credita opendriver.driver_earnings
#   ads:payout:read               -> hub confere o total de repasse devido
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
LABEL='Ecossistema (exclusao de conta + repasse de anuncio)'
ENVF=/root/openad/.env

q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1"; }

existe=$(q "SELECT count(*) FROM public.service_api_keys WHERE label = '$LABEL' AND active")

if [ "$existe" != '0' ]; then
  echo "A chave '$LABEL' ja existe e esta ativa."
  echo 'O texto puro so e mostrado na criacao (e o ponto de guardar apenas o hash).'
  q "SELECT key_preview || ' | escopos: ' || array_to_string(scopes, ',') FROM public.service_api_keys WHERE label = '$LABEL' AND active"
  echo ''
  echo 'Se precisar de uma nova, revogue a atual pelo Admin do hub e rode isto de novo.'
  exit 0
fi

echo '--- gerando chave'
# `openssl rand -hex 32` reproduz `crypto.randomBytes(32).toString('hex')` do hub.
SEGREDO="odh_svc_$(openssl rand -hex 32)"
HASH="$(printf '%s' "$SEGREDO" | openssl dgst -sha256 -hex | awk '{print $NF}')"
PREVIEW="$(printf '%s' "$SEGREDO" | cut -c1-12)…"

echo '--- inserindo em public.service_api_keys'
docker exec "$PG" psql -U postgres -d hub -q -c "
  INSERT INTO public.service_api_keys (label, hashed_key, key_preview, scopes, active)
  VALUES (
    '$LABEL',
    '$HASH',
    '$PREVIEW',
    ARRAY['account:read','account:purge','ads:earning:write','ads:payout:read'],
    true
  );
"

echo '--- gravando em integration_settings (Internal:AccountSyncKey)'
# É daqui que o `accountSync.ts` do hub lê, via `getSetting`. Rotacionável sem redeploy, que é
# a razão de a chave viver em `integration_settings` e não em variável de ambiente.
docker exec "$PG" psql -U postgres -d hub -q -c "
  INSERT INTO public.integration_settings (key, value, updated_at)
  VALUES ('Internal:AccountSyncKey', '$SEGREDO', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
"

echo '--- gravando OpenAd:ApiUrl e OpenAd:EarningKey'
docker exec "$PG" psql -U postgres -d hub -q -c "
  INSERT INTO public.integration_settings (key, value, updated_at) VALUES
    ('OpenAd:ApiUrl', 'https://adsapi.opendriver.com.br', now()),
    ('OpenAd:EarningKey', '$SEGREDO', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
"

echo '--- gravando no .env do openad'
if [ -f "$ENVF" ]; then
  # `sed` na linha existente em vez de append: duas linhas com a mesma chave fariam o
  # docker-compose usar a última, e a primeira ficaria como pista falsa num arquivo que
  # alguém vai ler durante um incidente.
  if grep -q '^ECOSYSTEM_SERVICE_API_KEY=' "$ENVF"; then
    sed -i "s|^ECOSYSTEM_SERVICE_API_KEY=.*|ECOSYSTEM_SERVICE_API_KEY=$SEGREDO|" "$ENVF"
  else
    printf '\nECOSYSTEM_SERVICE_API_KEY=%s\n' "$SEGREDO" >> "$ENVF"
  fi
  echo "gravado em $ENVF"
else
  echo "AVISO: $ENVF nao existe; rode 15-provisionar.sh primeiro" >&2
fi

echo ''
echo '=== conferencia ==='
q "SELECT label || ' | ' || key_preview || ' | ' || array_to_string(scopes, ',') FROM public.service_api_keys WHERE active ORDER BY created_at"
echo ''
echo 'chaves de integracao gravadas:'
q "SELECT key FROM public.integration_settings WHERE key LIKE 'OpenAd:%' OR key = 'Internal:AccountSyncKey' ORDER BY key"

echo ''
echo 'O texto puro NAO e exibido nem gravado em log. Ele esta em:'
echo "  - $ENVF (modo 600), para o openad"
echo '  - public.integration_settings, para o hub ler por getSetting()'
