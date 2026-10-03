#!/usr/bin/env bash
# Como o `hub-minio` da VPS nova está exposto, e onde o Coolify guarda as variáveis de
# ambiente do hub-backend (para corrigir `MINIO_PUBLIC_URL` pelo modelo dele, não por SQL solto).
set -uo pipefail
secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'LABELS DO hub-minio'
docker inspect hub-minio --format '{{json .Config.Labels}}' | tr ',' '\n' | head -30

secao 'REDES E PORTAS DO hub-minio'
docker inspect hub-minio --format 'redes: {{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker inspect hub-minio --format 'portas publicadas: {{json .NetworkSettings.Ports}}'

secao 'COMO FOI CRIADO (compose project?)'
docker inspect hub-minio --format '{{index .Config.Labels "com.docker.compose.project"}} / {{index .Config.Labels "com.docker.compose.project.config_files"}}'

secao 'COLUNAS DE environment_variables'
docker exec coolify-db psql -U coolify -d coolify -A -F '|' -c \
  "select column_name, data_type from information_schema.columns
   where table_name = 'environment_variables' order by ordinal_position;"

secao 'VARIAVEIS DO hub-backend COM minio NO NOME'
docker exec coolify php artisan tinker --execute='
$a = \App\Models\Application::where("uuid", "v6q66q2lv00ly550hffog7f5")->first();
foreach ($a->environment_variables as $e) {
  if (stripos($e->key, "minio") !== false) {
    echo $e->id . " | " . $e->key . " | " . $e->value . PHP_EOL;
  }
}' 2>/dev/null

secao 'ROTAS QUE O TRAEFIK CONHECE PARA storage/hubstorage'
docker exec coolify-proxy sh -c 'cat /traefik/dynamic/*.yaml 2>/dev/null | grep -i -E "hubstorage|storage|minio" | head -10' 2>/dev/null \
  || echo '(sem arquivo dinamico legivel)'
