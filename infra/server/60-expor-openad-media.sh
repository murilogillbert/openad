#!/usr/bin/env bash
#
# Acrescenta `/openad-media/` ao roteador de `storage.opendriver.com.br`, para o tablet poder
# baixar criativo por URL pre-assinada.
#
# O problema que isto resolve: `ManifestGeneratorService` entrega `downloadUrl` vinda de
# `AssetStorageService.getPresignedGetUrl`. Sem `S3_PUBLIC_ENDPOINT`, essa URL sai com o host
# interno `http://hub-minio:9000` - o aparelho nao resolve o nome, nenhum criativo baixa e a
# tela fica vazia. Definir `S3_PUBLIC_ENDPOINT` resolve metade; a outra metade e existir rota
# publica para o caminho do bucket.
#
# Por que por prefixo de caminho, e nao abrindo o host inteiro: o mesmo MinIO guarda
# `opendriver-private`, com CNH, selfie e CRLV de motorista. O roteador casa apenas
# `/hub-uploads/` e `/openad-media/`; qualquer outro caminho neste dominio nao tem rota.
#
# Por que expor `openad-media` nao expoe criativo: o bucket e privado. Leitura anonima devolve
# 403 mesmo para objeto existente - conferido por `59-conferir-politica-buckets.sh`. So URL
# assinada com SigV4 e dentro do prazo passa. `hub-uploads`, por outro lado, e publico por
# politica, e por isso ja estava exposto.
set -uo pipefail

DOMINIO='storage.opendriver.com.br'
DIR=/data/coolify/proxy/dynamic
ARQ="$DIR/storage-opendriver.yaml"

secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'ANTES'
cat "$ARQ" 2>/dev/null || echo '  (arquivo nao existe)'

mkdir -p "$DIR"

secao 'ESCREVENDO O ROTEADOR'
# Sem acento grave nos comentarios do heredoc: ele nao esta entre aspas (precisa expandir
# $DOMINIO), e acento grave em heredoc nao citado vira substituicao de comando. Na regra do
# Traefik o acento grave e obrigatorio pela sintaxe, e por isso vai escapado.
cat > "$ARQ" <<YAML
# Gerado por infra/server/60-expor-openad-media.sh (openad).
#
# Serve dois caminhos do hub-minio desta VPS em https://${DOMINIO}:
#
#   /hub-uploads/    bucket publico por politica (avatar, imagem de produto do hub)
#   /openad-media/   bucket PRIVADO; so URL pre-assinada passa. E o que o tablet usa para
#                    baixar criativo, a partir do downloadUrl do manifesto.
#
# A regra casa apenas esses dois prefixos, de proposito: o mesmo MinIO guarda
# opendriver-private, com documento de motorista. Fora dos prefixos nao existe rota.
http:
  routers:
    storage-opendriver:
      rule: "Host(\`${DOMINIO}\`) && (PathPrefix(\`/hub-uploads/\`) || PathPrefix(\`/openad-media/\`))"
      entryPoints:
        - https
      service: storage-opendriver
      tls:
        certResolver: letsencrypt

  services:
    storage-opendriver:
      loadBalancer:
        servers:
          - url: "http://hub-minio:9000"
YAML
echo "escrito: $ARQ"
cat "$ARQ"

secao 'CONFERINDO O ROTEAMENTO'
sleep 8
# De dentro da rede do proxy, forcando o Host: prova o roteador sem depender de DNS externo.
# Pela 443, porque o roteador declara entryPoints: [https].
docker run --rm --network coolify alpine:3.20 sh -c "
  apk add --no-cache curl >/dev/null
  ip=\$(getent hosts coolify-proxy | awk '{print \$1}' | head -1)
  echo \"proxy em \$ip\"

  echo '--- /openad-media/ sem assinatura (espera 403 do MinIO: rota existe, bucket privado):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/openad-media/qualquer.png\"

  echo '--- /hub-uploads/ inexistente (espera 404 do MinIO: bucket publico):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/hub-uploads/nao-existe.jpg\"

  echo '--- /opendriver-private/ (espera 404 do TRAEFIK: fora dos prefixos, sem rota):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}, %{size_download} bytes\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/opendriver-private/qualquer\"
"

secao 'PROXIMO PASSO'
cat <<'MSG'
Recriar o openad-api com S3_PUBLIC_ENDPOINT definida:

  cd /root/openad && docker compose -f docker-compose.prod.yml up -d api

Sem essa variavel a URL pre-assinada continua saindo com o host interno, e a rota criada aqui
nao e usada por ninguem.
MSG
