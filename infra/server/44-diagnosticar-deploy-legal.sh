#!/usr/bin/env bash
# Descobre qual commit cada container do Coolify esta rodando e se o email_off
# chegou no bundle compilado.
set -u

HUB=$(docker ps --format '{{.Names}}' | grep '^v6q66q2lv00ly550hffog7f5' | head -1)
OD=$(docker ps --format '{{.Names}}' | grep '^cag0pegfzuz1zfhkxgjsfzf2' | head -1)

inspecionar() {
  local nome="$1"
  local ctr="$2"
  echo "================ $nome ($ctr) ================"
  if [ -z "$ctr" ]; then
    echo "  container nao encontrado"
    return
  fi

  echo "-- labels de commit --"
  docker inspect "$ctr" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}
{{end}}' 2>/dev/null | grep -Ei 'commit|sha|version|git' || echo "  (sem label de commit)"

  echo "-- imagem --"
  docker inspect "$ctr" --format '{{.Image}} created={{.Created}}' 2>/dev/null
  docker inspect "$ctr" --format '{{.Config.Image}}' 2>/dev/null

  echo "-- arquivos legal* no container --"
  docker exec "$ctr" sh -lc 'find / -xdev -name "legal*" -not -path "*/node_modules/*" 2>/dev/null | head -20' || echo "  exec falhou"

  echo "-- ocorrencias de email_off --"
  n=$(docker exec "$ctr" sh -lc 'grep -rl "email_off" / --exclude-dir=proc --exclude-dir=sys --exclude-dir=node_modules 2>/dev/null | head -10' 2>/dev/null)
  if [ -z "$n" ]; then
    echo "  NENHUMA  <-- codigo antigo em producao"
  else
    echo "$n"
  fi

  echo "-- ocorrencias de mailto --"
  docker exec "$ctr" sh -lc 'grep -rl "mailto:" / --exclude-dir=proc --exclude-dir=sys --exclude-dir=node_modules 2>/dev/null | head -10' 2>/dev/null || true
  echo
}

inspecionar "HUB backend" "$HUB"
inspecionar "OpenDriver backend" "$OD"

echo "================ repositorios de origem do Coolify ================"
for d in /data/coolify/applications/*; do
  [ -d "$d/.git" ] || continue
  echo "--- $d"
  git -C "$d" log --oneline -1 2>/dev/null
  git -C "$d" remote get-url origin 2>/dev/null
done
