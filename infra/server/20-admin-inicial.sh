#!/usr/bin/env bash
#
# Cria o primeiro `super_admin` do portal do openad.
#
# Por que isto existe: o portal **não tem tela de cadastro de operador**, por desenho — quem
# cria usuário é um `super_admin` já autenticado. Numa base nova isso é um impasse, e o log da
# API o declara em todo boot ("No users in database"). A saída oficial é
# `UsersService.seedAdminUser`, que só age com a coleção de usuários vazia.
#
# Por que não é um backdoor: a guarda é `countDocuments() > 0`. Depois do primeiro boot
# bem-sucedido, estas variáveis deixam de ter efeito — não criam nem alteram ninguém. Mesmo
# assim a senha é aleatória e gravada só no `.env` (modo 600), não embutida em imagem nem em
# arquivo versionado.
#
# Idempotente: se o `.env` já tem as duas chaves preenchidas, não as sobrescreve. Regenerar a
# senha depois do primeiro boot produziria um `.env` que não abre a conta que existe de fato —
# exatamente o tipo de divergência silenciosa que custa uma hora de diagnóstico.
set -uo pipefail

DIR=/root/openad
ENVF="$DIR/.env"
EMAIL_PADRAO='admin@opendriver.com.br'

[ -f "$ENVF" ] || { echo "ABORTADO: $ENVF nao existe (rode 15-provisionar.sh primeiro)" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

if [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  echo "credencial de admin inicial ja existe no .env ($SEED_ADMIN_EMAIL) — mantida"
else
  EMAIL="${SEED_ADMIN_EMAIL:-$EMAIL_PADRAO}"
  # Sem caractere que precise de escape em YAML, shell ou URL: a senha passa por
  # `.env` -> docker compose -> variável de ambiente, e um `$` ou `'` no meio do caminho
  # vira um defeito de aspas em vez de um erro de autenticação legível.
  SENHA="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 24)"

  # `grep -q` antes de decidir entre substituir e acrescentar: o `.env` gerado pelas primeiras
  # execuções de `15-provisionar.sh` não tinha estas duas linhas.
  if grep -q '^SEED_ADMIN_EMAIL=' "$ENVF"; then
    sed -i "s|^SEED_ADMIN_EMAIL=.*|SEED_ADMIN_EMAIL=$EMAIL|" "$ENVF"
  else
    printf '\nSEED_ADMIN_EMAIL=%s\n' "$EMAIL" >> "$ENVF"
  fi
  if grep -q '^SEED_ADMIN_PASSWORD=' "$ENVF"; then
    sed -i "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$SENHA|" "$ENVF"
  else
    printf 'SEED_ADMIN_PASSWORD=%s\n' "$SENHA" >> "$ENVF"
  fi
  chmod 600 "$ENVF"
  echo "gravado SEED_ADMIN_EMAIL=$EMAIL no .env"
  echo 'a senha NAO e exibida aqui; leia com: grep SEED_ADMIN_PASSWORD /root/openad/.env'
fi

echo '--- recriando a API para que ela leia as variaveis novas'
cd "$DIR"
docker compose -f docker-compose.prod.yml up -d api 2>&1 | tail -5

echo '--- esperando o boot (ate 90s)'
for i in $(seq 1 18); do
  if docker logs openad-api 2>&1 | grep -q 'Nest application successfully started'; then
    break
  fi
  sleep 5
done

echo '--- o que a API disse sobre a semeadura'
docker logs openad-api 2>&1 | grep -i -E 'seeded default admin|No users in database' | tail -3

echo '--- conferindo no Mongo'
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
docker exec openad-mongo mongosh \
  --quiet \
  -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  openad \
  --eval 'JSON.stringify(db.users.find({}, { _id: 0, email: 1, role: 1 }).toArray())'

echo ''
echo '--- conferindo o login de verdade (POST /api/v1/auth/login)'
# A verificação é o login, não a existência do documento: senha gravada com hash diferente do
# que o `bcrypt.compare` espera produziria um usuário visível no banco e inutilizável na tela.
docker exec openad-api node -e '
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) { console.log("sem credencial no ambiente da API"); process.exit(1); }
fetch("http://127.0.0.1:3000/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
})
  .then(async (r) => {
    const corpo = await r.text();
    if (!r.ok) { console.log(`login FALHOU ${r.status}: ${corpo.slice(0, 300)}`); process.exit(1); }
    const j = JSON.parse(corpo);
    const token = j.accessToken ?? j.access_token ?? j.token;
    console.log(`login ok: token de ${String(token ?? "").length} caracteres, papel ${j?.user?.role ?? "?"}`);
  })
  .catch((e) => { console.log(`login FALHOU: ${e.message}`); process.exit(1); });
'
