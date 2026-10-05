#!/usr/bin/env bash
# O credito chegou ao opendriver?
#
# Separado de `69-` porque `docker logs` deste contêiner e lento o bastante para estourar o
# tempo de uma sessao de ssh. `--tail` pequeno e obrigatorio.
#
# Os eventos que interessam, emitidos por `DriverEarningClient`:
#   repasse.creditado  o opendriver confirmou
#   repasse.duplicado  409, ja lancado — caminho normal de retentativa, nao problema
#   repasse.recusado   o opendriver respondeu erro
#   repasse.falhou     rede/timeout; recuperavel pela conferencia
#   repasse.desligado  falta OPENDRIVER_API_URL ou ECOSYSTEM_SERVICE_API_KEY
set -u

echo '=== eventos de repasse no log da API'
docker logs openad-api --tail 600 2>&1 |
  grep -oE '"event":"repasse\.[a-z]+"[^,}]*(,"[a-zA-Z]+":("[^"]*"|[0-9]+))*' |
  tail -10 || true
echo

echo '=== a rota nova de veiculacoes por janela esta protegida?'
# Sem chave de servico deve dar 401. Isso prova que a rota existe e que o guard esta no lugar;
# o conteudo vem do mesmo codigo do relatorio de conferencia, que tem suite propria.
code=$(docker exec openad-api node -e "
  const q = new URLSearchParams({
    driverUserId: '0efd58a2-1fe8-4941-8168-87c5a982d054',
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
  });
  fetch('http://127.0.0.1:3000/api/v1/internal/ads/driver-plays?' + q, { signal: AbortSignal.timeout(8000) })
    .then(r => console.log('HTTP ' + r.status))
    .catch(e => console.log('FALHA ' + e.message));
" 2>&1 | tail -1)
echo "  sem chave: $code  (401 e o esperado)"
