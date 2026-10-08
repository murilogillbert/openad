#!/usr/bin/env bash
#
# Rotaciona a chave de servico do ecossistema para incluir os escopos de credito de veiculacao.
#
# ============================================================================
# Por que rotacionar, e nao editar
# ============================================================================
#
# A chave em producao foi emitida com quatro escopos (`account:read`, `account:purge`,
# `ads:earning:write`, `ads:payout:read`) e a Frente A exige dois novos:
#
#   ads:credit:charge  openad -> hub   pedir a cobranca Pix (a conta do Asaas e do hub)
#   ads:credit:write   hub -> openad   confirmar, estornar ou lancar credito no livro-caixa
#
# Chave de servico nao e editavel por desenho: o texto puro nunca e persistido, so o
# `sha256`. O escopo faz parte do que foi emitido. Entao o caminho e emitir uma nova com a
# lista completa e revogar a antiga **depois** de confirmar que a nova funciona — nessa ordem,
# porque a antiga ainda serve a exclusao de conta e o repasse ao motorista, e revogar antes
# derrubaria as duas por alguns minutos.
#
# Uma unica chave para os dois sentidos, de proposito: os tres servicos validam contra a
# **mesma** `public.service_api_keys`, entao emitir uma por direcao dobraria o numero de
# segredos a rotacionar sem reduzir o alcance de nenhum.
#
# Inserir a linha por SQL e legitimo e e o que a tela Admin -> Chaves de API faz
# (`serviceApiKeyService.ts`): 32 bytes aleatorios com prefixo `odh_svc_`, grava so o hash e
# um `key_preview`. A regra do ecossistema e que so o dono altera a **estrutura** do seu
# schema; gravar dado e o que a propria interface faz.
#
# Uso:
#   bash 94-rotacionar-chave-de-servico.sh estado
#   bash 94-rotacionar-chave-de-servico.sh emitir     # cria a nova e distribui
#   bash 94-rotacionar-chave-de-servico.sh revogar    # desativa as antigas, DEPOIS do smoke
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
ENVF=/root/openad/.env
LABEL_NOVO='Ecossistema v2 (conta + repasse + credito de veiculacao)'
# A antiga, por nome exato.
#
# A primeira versao revogava "toda chave ativa que nao seja a nova". Producao tem tambem
# `energia-solar-api`, com escopos `affiliate:*` e nenhuma relacao com esta rotacao — ela
# seria desativada junto, e a integracao de terceiro cairia sem ninguem ligar uma coisa a
# outra. Rotacao e uma troca entre duas chaves conhecidas, nao uma limpeza.
LABEL_ANTIGO='Ecossistema (exclusao de conta + repasse de anuncio)'
ESCOPOS="ARRAY['account:read','account:purge','ads:earning:write','ads:payout:read','ads:credit:charge','ads:credit:write']"

q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1"; }
titulo() { printf '\n========== %s ==========\n' "$1"; }

estado() {
  titulo 'chaves de servico'
  q "select case when active then 'ativa  ' else 'revogada' end || ' | ' || key_preview ||
            ' | ' || label || ' | ' || array_to_string(scopes, ',')
       from public.service_api_keys order by created_at"

  titulo 'quem tem os escopos de credito'
  printf 'com ads:credit:charge  %s\n' "$(q "select count(*) from public.service_api_keys where active and 'ads:credit:charge' = any(scopes)")"
  printf 'com ads:credit:write   %s\n' "$(q "select count(*) from public.service_api_keys where active and 'ads:credit:write' = any(scopes)")"

  titulo 'onde o segredo e lido'
  printf 'integration_settings  %s\n' "$(q "select case when count(*)>0 then 'presente' else 'AUSENTE' end from public.integration_settings where key='Internal:AccountSyncKey' and coalesce(value,'') <> ''")"
  printf 'OpenAd:EarningKey     %s\n' "$(q "select case when count(*)>0 then 'presente' else 'AUSENTE' end from public.integration_settings where key='OpenAd:EarningKey' and coalesce(value,'') <> ''")"
  printf '.env do openad        %s\n' "$(grep -q '^ECOSYSTEM_SERVICE_API_KEY=.\+' "$ENVF" 2>/dev/null && echo presente || echo AUSENTE)"
  printf 'no container openad   %s\n' "$([ -n "$(docker exec openad-api printenv ECOSYSTEM_SERVICE_API_KEY 2>/dev/null)" ] && echo presente || echo AUSENTE)"
}

emitir() {
  ja="$(q "select count(*) from public.service_api_keys where active and label = '$LABEL_NOVO'")"
  if [ "$ja" != '0' ]; then
    echo "A chave '$LABEL_NOVO' ja existe e esta ativa; nada a fazer."
    echo 'O texto puro so aparece na criacao — e o ponto de guardar apenas o hash.'
    exit 0
  fi

  echo '--- gerando (reproduz crypto.randomBytes(32).toString("hex") do hub)'
  SEGREDO="odh_svc_$(openssl rand -hex 32)"
  HASH="$(printf '%s' "$SEGREDO" | openssl dgst -sha256 -hex | awk '{print $NF}')"
  PREVIEW="$(printf '%s' "$SEGREDO" | cut -c1-12)…"

  echo '--- inserindo em public.service_api_keys'
  docker exec "$PG" psql -U postgres -d hub -q -v ON_ERROR_STOP=1 -c "
    INSERT INTO public.service_api_keys (label, hashed_key, key_preview, scopes, active)
    VALUES ('$LABEL_NOVO', '$HASH', '$PREVIEW', $ESCOPOS, true);
  " || { echo 'ABORTADO: insercao falhou' >&2; exit 1; }

  echo '--- distribuindo para o hub (integration_settings)'
  # Daqui o `accountSync.ts` e o `adCreditService` leem por `getSetting`. Rotacionavel sem
  # redeploy, que e a razao de a chave viver aqui e nao em variavel de ambiente do hub.
  docker exec "$PG" psql -U postgres -d hub -q -v ON_ERROR_STOP=1 -c "
    INSERT INTO public.integration_settings (key, value, updated_at) VALUES
      ('Internal:AccountSyncKey', '$SEGREDO', now()),
      ('OpenAd:EarningKey', '$SEGREDO', now()),
      ('OpenAd:ApiUrl', 'https://adsapi.opendriver.com.br', now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  " || { echo 'ABORTADO: integration_settings falhou' >&2; exit 1; }

  echo "--- distribuindo para o openad ($ENVF)"
  if [ ! -f "$ENVF" ]; then
    echo "ABORTADO: $ENVF nao existe" >&2
    exit 1
  fi
  cp -f "$ENVF" "${ENVF}.antes-rotacao"
  # `sed` na linha existente em vez de acrescentar: duas linhas com a mesma chave fazem o
  # compose usar a ultima, e a primeira fica como pista falsa num arquivo que alguem vai ler
  # durante um incidente.
  if grep -q '^ECOSYSTEM_SERVICE_API_KEY=' "$ENVF"; then
    sed -i "s|^ECOSYSTEM_SERVICE_API_KEY=.*|ECOSYSTEM_SERVICE_API_KEY=$SEGREDO|" "$ENVF"
  else
    printf '\nECOSYSTEM_SERVICE_API_KEY=%s\n' "$SEGREDO" >> "$ENVF"
  fi
  chmod 600 "$ENVF"
  # Confere que a linha ficou com o valor certo, sem imprimir o valor.
  if [ "$(grep -c "^ECOSYSTEM_SERVICE_API_KEY=$SEGREDO$" "$ENVF")" != '1' ]; then
    echo 'ABORTADO: a linha do .env nao ficou como esperado; restaurando' >&2
    mv -f "${ENVF}.antes-rotacao" "$ENVF"
    exit 1
  fi
  echo 'ok (uma linha, modo 600)'

  echo '--- recriando o openad-api para ler a variavel nova'
  cd /root/openad
  docker compose -f docker-compose.prod.yml up -d api 2>&1 | tail -3

  echo '--- esperando ficar saudavel (ate 120s)'
  for i in $(seq 1 24); do
    st="$(docker inspect openad-api --format '{{.State.Health.Status}}' 2>/dev/null)"
    printf '  %3ds  %s\n' "$((i * 5))" "${st:-sem status}"
    [ "$st" = 'healthy' ] && break
    sleep 5
  done

  echo ''
  echo 'O texto puro NAO foi exibido nem gravado em log. Ele esta em:'
  echo "  - $ENVF (modo 600), para o openad"
  echo '  - public.integration_settings, para o hub ler por getSetting()'
  echo ''
  echo 'Revogue a antiga SO DEPOIS do smoke:  bash 94-rotacionar-chave-de-servico.sh revogar'
}

revogar() {
  nova="$(q "select count(*) from public.service_api_keys where active and label = '$LABEL_NOVO'")"
  if [ "$nova" != '1' ]; then
    echo "ABORTADO: a chave nova nao esta ativa (encontrei $nova); nao revogo a antiga." >&2
    exit 1
  fi
  echo "--- revogando SO a chave antiga, por nome exato: $LABEL_ANTIGO"
  docker exec "$PG" psql -U postgres -d hub -q -v ON_ERROR_STOP=1 -c "
    UPDATE public.service_api_keys SET active = false
     WHERE active AND label = '$LABEL_ANTIGO';
  "
  echo '--- chaves de outras integracoes, que NAO foram tocadas'
  q "select key_preview || ' | ' || label || ' | ' || array_to_string(scopes, ',')
       from public.service_api_keys
      where active and label not in ('$LABEL_NOVO', '$LABEL_ANTIGO')"
  estado
}

case "${1:-estado}" in
  estado)  estado ;;
  emitir)  estado; emitir; estado ;;
  revogar) revogar ;;
  *) echo "uso: $0 [estado|emitir|revogar]" >&2; exit 1 ;;
esac
