#!/usr/bin/env bash
#
# Expõe o `hub-minio` da VPS nova em `storage.opendriver.com.br`, por **arquivo dinâmico** do
# Traefik, e corrige o `MINIO_PUBLIC_URL` do hub-backend.
#
# O defeito: `MINIO_PUBLIC_URL` está em
# `https://v6q66q2lv00ly550hffog7f5.179.236.228.94.sslip.io` — o domínio padrão do **próprio
# backend**. `minioStorage.uploadImage` devolve `${base}/${bucket}/${nome}`, então o primeiro
# upload gravaria no banco uma URL que o backend não serve. Hoje não há nenhuma linha quebrada
# (os 4 avatares existentes usam `hubstorage.opendriver.com.br`, e as outras 38 são do
# dicebear), então isto é defeito latente, não incidente — mas quebraria no primeiro upload.
#
# Por que um domínio **novo** e não `hubstorage.opendriver.com.br`:
#   - `hubstorage` fica no IP antigo (187.77.46.26) por decisão de topologia, e aponta para o
#     MinIO de lá. Os 4 avatares existem nos dois lados, então as URLs antigas continuam
#     servindo.
#   - Upload novo vai para o `hub-minio` **desta** VPS. Apontar `MINIO_PUBLIC_URL` para
#     `hubstorage` geraria URL para um MinIO que não tem o arquivo — imagem quebrada com o
#     arquivo intacto, que é o pior formato de falha para diagnosticar.
#
# Por que arquivo dinâmico e não label no contêiner:
#   O `hub-minio` foi criado com `docker run` solto — sem projeto de compose, sem label do
#   Coolify, sem label do Traefik. Label não se acrescenta a contêiner em execução: seria
#   preciso recriá-lo, reproduzindo à mão os argumentos originais de um contêiner que guarda
#   os uploads do hub e os documentos de motorista. Arquivo dinâmico obtém o mesmo resultado
#   sem tocar no contêiner.
#
# Por que não precisa de política nova no bucket:
#   `hub-uploads` já está com permissão anônima `download` — conferido. A URL que
#   `uploadImage` devolve não é assinada, então leitura anônima é requisito, e ela já existe.
#   `opendriver-private` **não** é exposto por este roteador: o roteador casa só o caminho
#   `/hub-uploads/`.
set -uo pipefail

DOMINIO='storage.opendriver.com.br'
HUB_UUID='v6q66q2lv00ly550hffog7f5'
secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'ONDE O TRAEFIK LE CONFIGURACAO DINAMICA'
docker exec coolify-proxy sh -c 'ls -la /traefik/dynamic/ 2>/dev/null' || true
docker inspect coolify-proxy --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}
{{end}}'

DIR=/data/coolify/proxy/dynamic
mkdir -p "$DIR"

secao "ESCREVENDO O ROTEADOR DE $DOMINIO"
# `PathPrefix(/hub-uploads/)` na regra é deliberado: sem ele, este domínio exporia **todo** o
# MinIO, incluindo `opendriver-private` (documento de motorista, comprovante) e
# `openad-media`. Com ele, só o bucket que já é público por política fica alcançável.
#
# Sem acento grave nos comentarios do heredoc: ele nao esta entre aspas (precisa expandir
# $DOMINIO), e acento grave dentro de heredoc nao citado vira substituicao de comando. Na
# primeira versao isso apagou metade dos comentarios do arquivo gerado. Na regra do roteador
# o acento grave e obrigatorio pela sintaxe do Traefik, e por isso vai escapado.
cat > "$DIR/storage-opendriver.yaml" <<YAML
# Gerado por infra/server/29-expor-storage.sh (openad).
#
# Serve o bucket publico hub-uploads do hub-minio desta VPS em
# https://${DOMINIO}/hub-uploads/<arquivo>
#
# A regra exige o prefixo /hub-uploads/ para que este dominio NAO exponha
# opendriver-private (documento de motorista) nem openad-media.
http:
  routers:
    storage-opendriver:
      rule: "Host(\`${DOMINIO}\`) && PathPrefix(\`/hub-uploads/\`)"
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
echo "escrito: $DIR/storage-opendriver.yaml"
cat "$DIR/storage-opendriver.yaml"

secao 'CONFERINDO QUE O TRAEFIK CARREGOU'
sleep 8
# O teste força o `Host` e resolve o nome para o proxy, de dentro da rede dele: prova que o
# roteador existe **sem** depender do DNS, que ainda não foi criado.
#
# E vai pela **443**, não pela 80: o roteador declara `entryPoints: [https]`. A primeira versão
# deste teste bateu na 80 e levou o 404 padrão do Traefik (19 bytes, "404 page not found"), o
# que eu quase interpretei como "o arquivo não existe no bucket".
#
# `-k` porque o certificado de `storage.opendriver.com.br` só pode ser emitido depois do DNS;
# o que está em teste aqui é o roteamento, não a cadeia de confiança.
ARQUIVO='4b26ee1a-41a2-40e8-ab07-b35bcb6ba768.jpg'
docker run --rm --network coolify alpine:3.20 sh -c "
  apk add --no-cache curl >/dev/null
  ip=\$(getent hosts coolify-proxy | awk '{print \$1}' | head -1)
  echo \"proxy em \$ip\"

  echo '--- arquivo existente, pelo roteador novo (espera 200):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}, %{size_download} bytes, %{content_type}\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/hub-uploads/${ARQUIVO}\"

  echo '--- bucket privado pelo mesmo dominio (espera 404 do Traefik, fora do prefixo):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/opendriver-private/\"

  echo '--- arquivo inexistente no bucket publico (espera 404 do MinIO, com corpo XML):'
  curl -sk -o /dev/null -w '  HTTP %{http_code}, %{size_download} bytes\n' \
    --resolve '${DOMINIO}:443:'\$ip \"https://${DOMINIO}/hub-uploads/nao-existe-mesmo.jpg\"
"

secao 'CORRIGINDO MINIO_PUBLIC_URL DO hub-backend'
# Pelo modelo do Coolify, não por UPDATE solto: é o Coolify que materializa o `.env` do
# contêiner no próximo deploy, e mexer na tabela por fora dele é como mexer no banco do Prisma
# sem migration.
docker exec coolify php artisan tinker --execute="
\$a = \App\Models\Application::where('uuid', '${HUB_UUID}')->first();
if (! \$a) { echo 'APP_NAO_ENCONTRADA'; exit; }
\$e = \$a->environment_variables()->where('key', 'MINIO_PUBLIC_URL')->first();
if (! \$e) { echo 'VARIAVEL_NAO_ENCONTRADA'; exit; }
echo 'antes:  ' . \$e->value . PHP_EOL;
\$e->value = 'https://${DOMINIO}';
\$e->save();
\$e->refresh();
echo 'depois: ' . \$e->value . PHP_EOL;
" 2>/dev/null

secao 'PROXIMO PASSO'
cat <<MSG
1. Criar no Cloudflare: ${DOMINIO}  A  179.236.228.94
   (cinza/DNS only ate o certificado emitir; depois pode ir para Full strict)
2. Rodar: bash /root/openad-infra/24-coolify-deploy.sh ${HUB_UUID}
   para o hub-backend passar a enxergar o MINIO_PUBLIC_URL novo.

Sem o passo 1 o upload continua gerando URL que nao resolve — igual a hoje, sem regressao.
MSG
