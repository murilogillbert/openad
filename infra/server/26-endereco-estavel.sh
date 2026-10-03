#!/usr/bin/env bash
#
# Descobre um endereço **estável** para o openad alcançar o backend do opendriver.
#
# Problema concreto: o `.env` do openad tinha
# `OPENDRIVER_API_URL=http://cag0pegfzuz1zfhkxgjsfzf2-000753239468:5100`, e o Coolify
# **renomeia o contêiner em cada deploy** — depois do redeploy ele passou a chamar
# `cag0pegfzuz1zfhkxgjsfzf2-134608006407`. Ou seja: todo deploy do opendriver quebraria o
# repasse ao motorista, e o sintoma seria repasse silenciosamente não enviado (o
# `DriverEarningClient` trata falha como "desligado" e segue), descoberto só na conferência.
#
# Este script testa os candidatos e diz qual resolve.
set -uo pipefail

ALVO='cag0pegfzuz1zfhkxgjsfzf2'

echo '--- aliases de rede que o Coolify registrou para o conteiner'
cont=$(docker ps --format '{{.Names}}' | grep "^${ALVO}" | head -1)
echo "conteiner: $cont"
docker inspect "$cont" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}: {{range $v.Aliases}}{{.}} {{end}}{{println}}{{end}}'

echo ''
echo '--- testando candidatos a partir do openad-api'
for u in "http://${ALVO}:5100" \
         "http://${cont}:5100" \
         'https://api-app.opendriver.com.br'; do
  code=$(docker exec openad-api curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u/health" 2>/dev/null)
  printf '  %-60s -> %s\n' "$u/health" "${code:-sem resposta}"
done
