#!/usr/bin/env bash
# A tela de vinculo de motorista esta de fato servida?
#
# "Fiz o build e implantei" ja conviveu com bundle antigo no contêiner mais de uma vez nesta
# base. A conferencia que vale e procurar o texto novo **dentro** do que o nginx serve.
set -u

RAIZ=$(docker exec openad-management sh -lc 'ls -d /usr/share/nginx/html 2>/dev/null || ls -d /app 2>/dev/null' | tr -d '\r')
echo "raiz servida: ${RAIZ:-(nao encontrada)}"
[ -z "${RAIZ:-}" ] && exit 1
echo

for trecho in 'admin/drivers/search' 'Motorista do aparelho' 'Repasse combinado' 'DEVICE_WITHOUT_VEHICLE'; do
  n=$(docker exec openad-management sh -lc "grep -rl -- '$trecho' $RAIZ 2>/dev/null | wc -l" | tr -d ' \r')
  if [ "${n:-0}" = '0' ]; then
    echo "  AUSENTE  $trecho"
  else
    echo "  ok       $trecho  (${n} arquivo(s))"
  fi
done

echo
echo '=== a rota da API responde pelo endereco publico?'
code=$(curl -s -o /dev/null -w '%{http_code}' https://adsapi.opendriver.com.br/api/v1/admin/drivers/search?q=teste)
echo "  GET /admin/drivers/search sem token -> HTTP $code  (401 e o esperado)"
