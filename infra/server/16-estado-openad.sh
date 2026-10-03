#!/usr/bin/env bash
# Estado dos servicos do openad na VPS. Somente leitura.
set -uo pipefail
cd /root/openad 2>/dev/null || { echo 'nao ha /root/openad'; exit 1; }

echo '=== compose ps ==='
docker compose -f docker-compose.prod.yml ps 2>&1 || true

echo ''
echo '=== containers do openad ==='
docker ps -a --format '{{.Names}} | {{.Status}}' | grep -E '^openad' || echo '(nenhum)'

echo ''
echo '=== saude ==='
for c in openad-mongo openad-redis openad-rabbitmq openad-api openad-management; do
  s=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem healthcheck{{end}}' "$c" 2>/dev/null || echo 'nao existe')
  echo "$c -> $s"
done

echo ''
echo '=== memoria ==='
docker stats --no-stream --format '{{.Name}} | {{.MemUsage}} | {{.MemPerc}}' 2>/dev/null \
  | grep -E '^openad' || echo '(nenhum rodando)'
echo '--- host ---'
free -h | head -2

echo ''
echo '=== ultimas linhas de log da api ==='
docker logs --tail 30 openad-api 2>&1 || echo '(container api nao existe)'
