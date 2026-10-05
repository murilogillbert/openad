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
echo '=== procura do nome da variavel no bundle (indicio fraco, nao veredito)'
# Nao confie nesta contagem: o bundle e minificado e empacotado, e o nome pode nao sobreviver
# como literal nem estar sob /app/dist. Na pratica ela deu 0 para uma imagem que **tinha** o
# codigo. O veredito esta na secao seguinte, que observa o comportamento.
for d in /app/dist /app/main.js /app; do
  n=$(docker exec openad-api sh -lc "grep -ro S3_PUBLIC_ENDPOINT $d 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \r')
  echo "  $d: ${n:-0}"
done

echo
echo '=== VEREDITO: o manifesto entrega host publico?'
# Esta e a unica conferencia que vale: pergunta ao proprio servico qual URL ele assina. Se o
# host for `hub-minio`, a imagem nao tem o codigo (ou a variavel nao chegou) e o tablete nao
# consegue baixar criativo.
host=$(bash "$(dirname "$0")/64-manifesto-do-aparelho.sh" 2>/dev/null | grep -oE 'host [^ ]+' | head -1 | cut -d' ' -f2)
echo "  host no downloadUrl: ${host:-'(nao consegui ler)'}"
case "${host:-}" in
  hub-minio*) echo '  >> FALHA: host interno. O tablete nao resolve esse nome.' ;;
  '')         echo '  >> inconclusivo' ;;
  *)          echo '  >> ok' ;;
esac

echo
echo '=== imagem e data de criacao'
docker inspect openad-api --format '  {{.Config.Image}}  criada {{.Created}}'
docker image inspect openad-api:latest --format '  openad-api:latest criada {{.Created}}  id {{.Id}}'
