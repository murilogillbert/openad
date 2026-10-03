#!/usr/bin/env bash
#
# Levanta a topologia real de rede e armazenamento. **Somente leitura.**
#
# Existe porque o DNS nao responde a pergunta: todos os subdominios estao proxiados pelo
# Cloudflare e resolvem para os mesmos IPs de borda. A origem de cada servico so e visivel
# pela configuracao de quem o consome.
#
# A pergunta concreta: ha um `hub-minio` rodando nesta VPS **e** um `hubstorage` apontando
# para a VM antiga. Se as aplicacoes gravam num e leem do outro, upload "funciona" e o
# arquivo nunca aparece — defeito que se manifesta semanas depois, como arquivo sumido.
set -uo pipefail

secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'ARMAZENAMENTO: O QUE CADA CONTAINER APONTA'
for c in $(docker ps --format '{{.Names}}'); do
  e=$(docker exec "$c" printenv 2>/dev/null \
        | grep -iE '^(S3_|MINIO_|STORAGE_|AWS_|MEDIA_)' \
        | sed -E 's/(SECRET[A-Z_]*|PASSWORD|ACCESS_KEY[A-Z_]*)=.*/\1=***/') || true
  if [ -n "${e:-}" ]; then
    echo "--- $c"
    echo "$e"
  fi
done
echo '(vazio = nenhum container no ar declara configuracao de armazenamento)'

secao 'URLS EXTERNAS QUE AS APLICACOES CONSOMEM'
for c in $(docker ps --format '{{.Names}}'); do
  e=$(docker exec "$c" printenv 2>/dev/null \
        | grep -iE '^[A-Z_]*(URL|URI|HOST|ENDPOINT)=' \
        | grep -viE 'DATABASE_URL|REDIS' \
        | sed -E 's#(://[^:/]+):[^@]*@#\1:***@#') || true
  if [ -n "${e:-}" ]; then
    echo "--- $c"
    echo "$e"
  fi
done

secao 'O QUE O hub-minio DESTA VPS GUARDA'
if docker ps --format '{{.Names}}' | grep -qx 'hub-minio'; then
  docker run --rm -v hub-minio-data:/d:ro alpine:3.20 sh -c \
    'for b in /d/*/; do [ -d "$b" ] || continue; n=$(find "$b" -type f | wc -l); echo "$(basename "$b") | $n arquivo(s) | $(du -sh "$b" | cut -f1)"; done'
  echo '--- objeto mais recente por bucket (data de escrita)'
  docker run --rm -v hub-minio-data:/d:ro alpine:3.20 sh -c \
    'for b in /d/*/; do [ -d "$b" ] || continue; case "$(basename "$b")" in .minio.sys) continue;; esac; u=$(find "$b" -type f -printf "%T@ %TY-%Tm-%Td %TH:%TM\n" 2>/dev/null | sort -rn | head -1 | cut -d" " -f2-); echo "$(basename "$b") | ultimo: ${u:-nenhum}"; done'
else
  echo 'hub-minio nao esta no ar nesta VPS'
fi

secao 'A VM ANTIGA RESPONDE? (servicos que ficam la)'
# Os quatro que permanecem em 187.77.46.26, por decisao de 2026-10-03.
for alvo in hubstorage n8n evolution solarapi; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
          "https://${alvo}.opendriver.com.br" 2>/dev/null || echo 'sem resposta')
  echo "${alvo}.opendriver.com.br | HTTP ${code}"
done

secao 'ORIGEM REAL ATRAS DO CLOUDFLARE'
# O Cloudflare esconde a origem, mas a VM antiga e alcancavel direto pelo IP. Se o host
# antigo responde no IP e a VPS nova nao serve aquele nome, a origem e a antiga.
for porta in 80 443; do
  if timeout 5 bash -c "echo > /dev/tcp/187.77.46.26/$porta" 2>/dev/null; then
    echo "187.77.46.26:$porta | ABERTA (VM antiga viva)"
  else
    echo "187.77.46.26:$porta | sem resposta"
  fi
done

secao 'ROTAS QUE O TRAEFIK DESTA VPS SERVE'
# A fonte da verdade sao os labels dos containers, nao arquivo de configuracao: o Coolify
# publica por label.
docker ps --format '{{.Names}}' | while read -r c; do
  h=$(docker inspect "$c" --format '{{range $k,$v := .Config.Labels}}{{if eq $k "traefik.enable"}}{{end}}{{end}}{{range $k,$v := .Config.Labels}}{{$v}}
{{end}}' 2>/dev/null | grep -oE 'Host\(`[^`]+`\)' | sed 's/Host(`//; s/`)//' | sort -u | tr '\n' ' ')
  if [ -n "$h" ]; then
    echo "$c | $h"
  fi
done
echo '(vazio = nenhum dominio publicado por label)'

secao 'FIM'
