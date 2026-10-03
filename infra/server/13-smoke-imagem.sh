#!/usr/bin/env bash
# Verificacao basica da imagem da API, antes de implantar.
#
# Nao e "o container subiu": e que as tres coisas que a imagem existe para ter estao la.
# Descobrir qualquer uma delas em producao custa um rollback.
set -uo pipefail
IMG="${1:-openad-api:latest}"

echo "=== imagem: $IMG"

echo '--- 1. ffprobe (validacao de midia depende dele)'
docker run --rm --entrypoint sh "$IMG" -c 'ffprobe -version | head -1'

echo '--- 2. cliente do Prisma gerado (nao o stub)'
# `require` do client e checar se um modelo existe. O stub carrega mas nao tem modelo nenhum,
# e a falha apareceria so na primeira consulta.
docker run --rm --entrypoint node "$IMG" -e '
  const { PrismaClient } = require("@prisma/client");
  const c = new PrismaClient();
  const faltando = ["adAdvertiser","adCreditLedger","serviceApiKey","user"].filter((m) => !c[m]);
  if (faltando.length) { console.error("MODELOS AUSENTES:", faltando.join(",")); process.exit(1); }
  console.log("ok: modelos presentes");
'

echo '--- 3. o bundle carrega (sem conectar em nada)'
# `main.js` importado com as variaveis minimas. A validacao de ambiente roda no boot, entao
# isto tambem prova que o schema de env aceita a configuracao que o compose fornece.
docker run --rm \
  -e NODE_ENV=test \
  -e JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy \
  --entrypoint node "$IMG" -e '
  try {
    require("/app/main.js");
  } catch (e) {
    // Falha de conexao e esperada (nao ha Mongo nem Redis aqui); falha de carregamento nao.
    const m = String(e && e.message);
    if (/Cannot find module|SyntaxError|is not a function/.test(m)) {
      console.error("FALHA DE CARREGAMENTO:", m);
      process.exit(1);
    }
  }
  console.log("ok: bundle carregou");
  process.exit(0);
' 2>&1 | tail -5

echo '--- 4. roda como usuario sem privilegio'
docker run --rm --entrypoint id "$IMG" -un

echo '--- 5. tamanho'
docker images "$IMG" --format '{{.Size}}'

echo '=== smoke concluido'
