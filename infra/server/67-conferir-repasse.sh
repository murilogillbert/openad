#!/usr/bin/env bash
# O repasse ao motorista esta de fato ligado em producao?
#
# `DriverEarningClient.habilitado()` exige OPENDRIVER_API_URL **e**
# ECOSYSTEM_SERVICE_API_KEY. Sem as duas ele nao envia nada e **nao reclama** - por decisao
# documentada, para nao derrubar a reconciliacao de analytics em dev e nas suites. Em
# producao o mesmo silencio significa motorista veiculando de graca, e o unico sinal e a
# divergencia do relatorio de conferencia. Esta e a conferencia que falta.
set -u

echo '=== variaveis do repasse no container da API'
for v in OPENDRIVER_API_URL ECOSYSTEM_SERVICE_API_KEY DATABASE_URL JWT_SECRET; do
  val=$(docker exec openad-api printenv "$v" 2>/dev/null || true)
  if [ -z "$val" ]; then
    echo "  $v: AUSENTE"
  else
    # Nunca imprime o valor: duas destas sao segredo. Tamanho e prefixo bastam para decidir.
    case "$v" in
      OPENDRIVER_API_URL|DATABASE_URL) echo "  $v: ${#val} chars  inicio=$(echo "$val" | cut -c1-28)" ;;
      *) echo "  $v: presente (${#val} chars)" ;;
    esac
  fi
done

echo
echo '=== veredito'
u=$(docker exec openad-api printenv OPENDRIVER_API_URL 2>/dev/null || true)
k=$(docker exec openad-api printenv ECOSYSTEM_SERVICE_API_KEY 2>/dev/null || true)
if [ -n "$u" ] && [ -n "$k" ]; then
  echo '  repasse LIGADO'
else
  echo '  repasse DESLIGADO: veiculacao faturavel nao credita o motorista'
fi

echo
echo '=== o openad alcanca o opendriver?'
if [ -n "$u" ]; then
  code=$(docker exec openad-api node -e "
    fetch(process.env.OPENDRIVER_API_URL.replace(/\/+$/,'') + '/api/v1/health', { signal: AbortSignal.timeout(8000) })
      .then(r => console.log('HTTP ' + r.status))
      .catch(e => console.log('FALHA ' + (e && e.message ? e.message : e)));
  " 2>&1 | tail -1)
  echo "  GET /api/v1/health -> $code"
else
  echo '  sem endereco para testar'
fi

echo
echo '=== motoristas no espelho de identidade (public.users, role=Driver)'
# Nao usa Prisma: `node -e` no container nao tem o client gerado no PATH do script. `psql`
# tambem nao esta na imagem alpine. Resta o proprio Prisma do app, via $queryRaw.
docker exec openad-api node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.\$queryRawUnsafe(\"select count(*)::int as n from public.users where role = 'Driver'\")
    .then(r => console.log('  motoristas: ' + r[0].n))
    .catch(e => console.log('  FALHA: ' + (e && e.message ? String(e.message).slice(0,200) : e)))
    .finally(() => p.\$disconnect());
" 2>&1 | grep -E 'motoristas|FALHA' || echo '  (sem saida)'
