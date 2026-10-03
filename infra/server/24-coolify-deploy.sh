#!/usr/bin/env bash
#
# Dispara, acompanha e confere o redeploy de uma aplicação gerenciada pelo Coolify.
#
# Por que isto existe: os contêineres de produção do `hub-backend` e do `opendriver-backend`
# estavam **atrás** do `main` dos repositórios — o hub em `c1ccd39` contra `fe08d53`, e o
# opendriver em `ef40bfd`, três commits atrás de `042fa9f`. Nenhum dos dois tinha as rotas
# `/internal/*`, e a verificação fim a fim devolvia 404 nelas. O deploy automático por webhook
# não está funcionando, então empurrar para o git não é suficiente.
#
# Por que pela API/código do Coolify e não trocando a imagem na mão: o Coolify é o dono do
# ciclo de vida desses contêineres. Substituir a imagem por fora funcionaria até o próximo
# deploy pela interface — e aí voltaria sozinho para a versão antiga, sem ninguém ter mexido
# em nada. É o pior formato de regressão possível.
#
# Por que por `artisan tinker` e não pela API HTTP: existe um token de API no banco
# (`claude-automation`, habilidade `root`), mas o Laravel guarda apenas
# `hash('sha256', $token)` — o valor em texto não é recuperável. A alternativa seria inserir um
# token novo direto na tabela, o que criaria credencial de administração do orquestrador por
# fora da interface dele, sem trilha de auditoria. O `tinker` roda no contexto da aplicação e
# chama **a mesma** função que o controlador da API chama (`DeployController::deploy_resource`),
# com os mesmos argumentos nomeados.
set -uo pipefail

UUID="${1:?uso: 24-coolify-deploy.sh <uuid-da-aplicacao> [forcar]}"
FORCAR="${2:-sim}"

php_force='true'
[ "$FORCAR" = 'nao' ] && php_force='false'

secao() { printf '\n========== %s ==========\n' "$1"; }

secao "ESTADO ANTES ($UUID)"
docker exec coolify-db psql -U coolify -d coolify -A -F '|' -c \
  "select name, git_branch, status, fqdn from applications where uuid = '$UUID';"

secao 'DISPARANDO O DEPLOY'
# `force_rebuild: true` por padrão: sem ele o Coolify pode reaproveitar camada de build antiga
# e o objetivo aqui é justamente trazer código novo.
DEPLOY_UUID=$(docker exec coolify php artisan tinker --execute="
\$app = \App\Models\Application::where('uuid', '$UUID')->first();
if (! \$app) { echo 'APP_NAO_ENCONTRADA'; exit; }
\$du = new_public_id();
\$r = queue_application_deployment(
  application: \$app,
  deployment_uuid: \$du,
  force_rebuild: $php_force,
  pull_request_id: 0,
  is_api: true,
);
echo \$du;
" 2>/dev/null | tr -d '\r\n ')

if [ -z "$DEPLOY_UUID" ] || [ "$DEPLOY_UUID" = 'APP_NAO_ENCONTRADA' ]; then
  echo "ABORTADO: nao consegui enfileirar o deploy ($DEPLOY_UUID)" >&2
  exit 1
fi
echo "deployment_uuid: $DEPLOY_UUID"

secao 'ACOMPANHANDO (ate 15 min)'
# O build de um backend Node nesta VPS leva alguns minutos. O laço acompanha o estado na fila
# do Coolify em vez de dormir um tempo fixo — dormir pouco daria falso negativo e dormir muito
# desperdiçaria a janela de manutenção.
estado=''
for i in $(seq 1 90); do
  estado=$(docker exec coolify-db psql -U coolify -d coolify -At -c \
    "select status from application_deployment_queues where deployment_uuid = '$DEPLOY_UUID';" 2>/dev/null | tr -d '\r\n ')
  printf '  %3ds  %s\n' "$((i * 10))" "${estado:-sem registro}"
  case "$estado" in
    finished|failed|cancelled-by-user) break ;;
  esac
  sleep 10
done

secao 'RESULTADO'
echo "estado final: $estado"

if [ "$estado" != 'finished' ]; then
  echo '--- ultimas linhas do log do deploy'
  docker exec coolify-db psql -U coolify -d coolify -At -c \
    "select logs from application_deployment_queues where deployment_uuid = '$DEPLOY_UUID';" 2>/dev/null \
    | tail -c 3000
  echo ''
  echo "DEPLOY NAO CONCLUIU ($estado)" >&2
  exit 1
fi

secao 'ESTADO DEPOIS'
docker exec coolify-db psql -U coolify -d coolify -A -F '|' -c \
  "select name, status, fqdn from applications where uuid = '$UUID';"
echo '--- conteiner no ar'
docker ps --format '{{.Names}} | {{.Status}} | {{.Image}}' | grep "^${UUID}" || \
  echo "ATENCAO: nenhum conteiner com prefixo $UUID esta rodando"
