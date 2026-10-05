#!/usr/bin/env bash
#
# Confere se a imagem em execucao contem o codigo que le `S3_PUBLIC_ENDPOINT`.
#
# Por que: o manifesto do aparelho continua entregando `downloadUrl` com host `hub-minio:9000`
# mesmo com a variavel definida e visivel dentro do container. Variavel presente e
# comportamento antigo tem uma explicacao simples e comum: a imagem em producao foi construida
# antes do codigo que le a variavel. Definir a variavel sem trocar a imagem nao muda nada.
set -u

echo '=== variavel no container'
docker exec openad-api printenv S3_PUBLIC_ENDPOINT 2>/dev/null || echo '  (ausente)'

echo
echo '=== o bundle compilado menciona a variavel?'
n=$(docker exec openad-api sh -lc 'grep -ro S3_PUBLIC_ENDPOINT /app/dist 2>/dev/null | wc -l' 2>/dev/null | tr -d ' \r')
echo "  ocorrencias em /app/dist: ${n:-0}"
if [ "${n:-0}" = '0' ]; then
  echo '  >> A IMAGEM E ANTIGA. O codigo em execucao nao conhece S3_PUBLIC_ENDPOINT.'
fi

echo
echo '=== o bundle menciona signingClient?'
m=$(docker exec openad-api sh -lc 'grep -ro signingClient /app/dist 2>/dev/null | wc -l' 2>/dev/null | tr -d ' \r')
echo "  ocorrencias: ${m:-0}"

echo
echo '=== imagem e data de criacao'
docker inspect openad-api --format '  {{.Config.Image}}  criada {{.Created}}'
docker image inspect openad-api:latest --format '  openad-api:latest criada {{.Created}}  id {{.Id}}'
