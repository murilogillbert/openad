#!/usr/bin/env bash
# Confere se os buckets do MinIO aceitam leitura **anonima**.
#
# Por que isto importa agora: o manifesto do tablet entrega `downloadUrl` pre-assinada, e para
# o tablet alcancar o arquivo e preciso expor o MinIO num dominio publico. Se o bucket
# `openad-media` responder a requisicao sem assinatura, a rota publica deixaria de ser
# "URL assinada e temporaria" e passaria a ser "todo criativo acessivel por quem souber a
# chave". Com o bucket privado, a assinatura SigV4 e o unico caminho - e e isso que se quer.
#
# `opendriver-private` entra no teste de proposito: e onde ficam CNH, selfie e CRLV de
# motorista. Qualquer resposta 200 ali e incidente, nao configuracao.
set -u

# Chave real de um criativo ja existente, e uma chave inventada para separar "negado" de
# "nao existe".
CHAVE_REAL='openad/vfs/5d09474b-b907-4b2a-a0e0-098262ad7bcf/criativo-16x9-1791154561870.jpg'

testar() {
  local bucket="$1"
  local chave="$2"
  local rotulo="$3"
  local codigo
  codigo=$(docker exec openad-api sh -lc "wget -qS -O /dev/null 'http://hub-minio:9000/${bucket}/${chave}' 2>&1 | awk '/HTTP\\//{print \$2}' | head -1" 2>/dev/null)
  [ -z "$codigo" ] && codigo='sem-resposta'
  printf '  %-22s %-62s %s\n' "$bucket" "$rotulo" "$codigo"
}

echo '=== leitura ANONIMA pelo endpoint interno (sem assinatura)'
echo '    403 = bucket privado (desejado).  200 = bucket publico.'
testar 'openad-media'       "$CHAVE_REAL"            'criativo real'
testar 'openad-media'       'nao-existe-xyz.png'     'chave inexistente'
testar 'hub-uploads'        'nao-existe-xyz.png'     'chave inexistente'
testar 'opendriver-private' 'nao-existe-xyz.png'     'chave inexistente (documento de motorista)'

echo
echo '=== S3_PUBLIC_ENDPOINT esta definida?'
val=$(docker exec openad-api printenv S3_PUBLIC_ENDPOINT 2>/dev/null || true)
if [ -z "${val:-}" ]; then
  echo '  NAO definida -> a URL pre-assinada sai com o host interno http://hub-minio:9000,'
  echo '  que o tablet nao resolve. E a causa de nenhum criativo baixar.'
else
  echo "  $val"
fi

echo
echo '=== buckets que existem no MinIO'
docker exec hub-minio sh -lc 'ls -1 /data 2>/dev/null' || echo '  nao consegui listar /data'
