#!/usr/bin/env bash
# Mostra exatamente como o controlador da API do Coolify chama `queue_application_deployment`,
# para o script de deploy reproduzir a mesma chamada por `artisan tinker`.
set -uo pipefail
docker exec coolify sh -c \
  "sed -n '515,565p' /var/www/html/app/Http/Controllers/Api/DeployController.php"
