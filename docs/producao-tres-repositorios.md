# Guia de execução em produção — hub, opendriver e openad

> Escrito em 2026-10-02 para ser executado **no servidor**, com Kiro conectado por conexão
> remota. Cobre os três repositórios do ecossistema.
>
> Leia a §0 e a §1 inteiras antes de rodar qualquer comando. A §1 é a razão pela qual este
> documento existe: o banco é **um só** e é compartilhado, e um comando errado em qualquer um
> dos três repositórios derruba os outros dois.

Servidor: `179.236.228.94`. Domínio: `opendriver.com.br`, atrás do Cloudflare.
A VM antiga (`187.77.46.26`) continua servindo `coolify`, `hubstorage`, `n8n`, `evolution` e
`solarapi` até a migração terminar.

---

## 0. Como ler este documento

Cada tarefa tem a mesma estrutura: **o que**, **por que**, **comandos**, **como verificar** e
**como voltar atrás**. Risco marcado como 🟢 reversível, 🟡 reversível com trabalho,
🔴 difícil de reverter ou com efeito em produção ao vivo.

O que está escrito como comando foi conferido contra o código dos três repositórios, mas
**não foi executado no servidor** — eu não tenho acesso a ele. Nenhuma linha aqui foi validada
contra o estado real de produção. Trate tudo como proposta a conferir, especialmente nomes de
contêiner e caminhos, que podem ter mudado desde a última vez que os documentos foram escritos.

Duas coisas que eu **não consigo saber** e você precisa confirmar logo no começo:

1. **O que está de fato aplicado no banco de produção.** Os documentos dizem 12 de 14
   migrations do opendriver e nenhuma das novas do hub, mas isso é documentação, não leitura do
   banco. A §2.1 começa justamente por aí.
2. **Se o Coolify do servidor novo já tem as aplicações.** Você disse que ele gerencia o
   servidor novo em `http://179.236.228.94:8000` mas que falta atualizar lá.

---

## 1. Precauções — leia antes de tudo

### 1.1 O banco é compartilhado, e cada schema tem um dono

Um único Postgres, um único banco chamado `hub`, três schemas:

| Schema | Dono | Quem pode alterar a estrutura |
|---|---|---|
| `public` | hub | **somente** migrations do repositório `hub` |
| `opendriver` | opendriver | somente migrations do repositório `opendriver` |
| `openad` | openad | somente migrations do repositório `openad` |

Opendriver e openad **espelham** colunas de `public` nos seus `schema.prisma`. Esses espelhos
são declarações de leitura, não fonte da verdade. Se você rodar um comando que gere migration
a partir de um espelho, o Prisma vai propor apagar metade do `public` — porque o espelho é
parcial por desenho.

### 1.2 Comandos proibidos

Estes três destroem dados em produção. Não existe caso de uso legítimo para nenhum deles aqui.

```bash
prisma migrate dev     # gera migration comparando com o banco → propõe DROP no schema alheio
prisma db push         # sincroniza à força, sem histórico
prisma migrate reset   # apaga tudo
```

Em produção **só** `prisma migrate deploy`, e só depois do protocolo de backup da §1.4.

### 1.3 A armadilha do shadow database

```bash
# NUNCA faça isto apontando para um banco que você quer manter:
prisma migrate diff --shadow-database-url <banco_real> ...
```

O Prisma **reseta** o shadow database antes de usá-lo. Eu caí nessa durante o
desenvolvimento: o comando apagou o Postgres local que eu acabara de montar, com as migrations
do hub e do openad já aplicadas. Em produção isso seria perda total.

Se precisar comparar schema, use um banco descartável — ou melhor, o `pg_dump` da §1.4, que é
o critério oficial e não escreve nada.

### 1.4 Protocolo de migration — cinco passos, sem exceção

Vem de `opendriver/docs/plano-producao-final.md` e vale para os três repositórios:

1. **Backup completo do banco.**
2. `pg_dump --schema-only --schema=public` → guarde como `antes.sql`.
3. Aplicar o bootstrap do histórico, se for o primeiro deploy daquele schema (idempotente).
4. `prisma migrate deploy`.
5. `pg_dump --schema-only --schema=public` → `depois.sql`, e **diff contra o passo 2**.

O critério do passo 5 muda conforme o repositório, e isso é importante:

| Repositório | `public` deve mudar? | Critério |
|---|---|---|
| **hub** | **sim** | A mudança tem de ser exatamente a da migration. Qualquer coisa além disso: parar. |
| **opendriver** | **não** | Única diferença aceitável: o token aleatório de `\restrict`/`\unrestrict`, que o `pg_dump` varia a cada execução. |
| **openad** | **não** | Idem. Eu validei esse critério localmente e o `public` ficou intocado. |

Se o diff mostrar qualquer outra coisa: **pare e reporte.** Não continue, não tente consertar
no ar.

### 1.5 Variável de ambiente no Coolify só vale depois de redeploy

As três aplicações leem o ambiente **no boot**. Mudar `PAYMENT_PROVIDER` no painel e não
redeployar resulta em um sistema que parece configurado e continua em mock. Isso já é
explicitamente alertado no plano do opendriver.

### 1.6 Segredo nunca entra em arquivo

Credenciais de Asaas, Infosimples e afins vivem **só** em `public.integration_settings`, pelo
Admin → Integrações do hub. Não em `.env`, não em código, não em commit. O `updateSetting`
recusa chave fora do catálogo, o que é proteção e também limitação — ver §5.3.

### 1.7 MQTT não atravessa o proxy do Cloudflare

O proxy do Cloudflare encaminha HTTP e WebSocket, **não** TCP bruto nas portas 1883/8883. O
player depende de MQTT. Três saídas, em ordem de preferência:

1. **MQTT sobre WebSocket seguro** em subdomínio próprio (`mqtt.opendriver.com.br`), proxiado.
   É o que convive melhor com o resto da infraestrutura. Exige habilitar o plugin
   `rabbitmq_web_mqtt` e ajustar o cliente do tablete.
2. Subdomínio **cinza** (sem proxy) com TLS próprio na porta 8883. Funciona, mas expõe o IP de
   origem.
3. Porta direta sem TLS. **Não faça**: credencial de tablete trafegaria em claro.

Isso precisa ser decidido **antes** de provisionar, porque muda a configuração do broker e do
aplicativo.

### 1.8 O keystore de release do player é irreparável

A autoatualização silenciosa por `PackageInstaller` exige que o APK novo tenha **a mesma
assinatura** do instalado. Crie a chave uma vez, guarde em dois lugares, e nunca a perca:
perder significa reprovisionar cada tablete à mão, com `dpm set-device-owner`, presencialmente.

Guarde também as senhas (`OPENAD_RELEASE_STORE_PASSWORD`, `OPENAD_RELEASE_KEY_PASSWORD`) junto
— chave sem senha é igualmente inútil.

### 1.9 Mídia do openad é vídeo: não vai em disco de servidor

O catálogo é MP4. Use **Cloudflare R2** (`S3_REGION=auto`,
`S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), que é o que o
`.env.example` já documenta para produção. O `hubstorage` (MinIO) está na VM antiga e não deve
receber carga nova.

### 1.10 Dois detalhes do openad que travam o boot se esquecidos

- `DATABASE_URL` **tem** de conter `?schema=openad`. A validação de ambiente recusa o boot sem
  isso, de propósito: sem o parâmetro, o histórico de migrations do openad iria para o schema
  do hub.
- `JWT_SECRET` tem de ser **idêntico** ao do hub e do opendriver, com no mínimo 32 caracteres.
  A validação recusa menos que isso. Token de um serviço vale nos três; segredo curto
  compromete os três de uma vez.

---

## 2. Ordem de execução

A ordem abaixo é opinião, e a razão de cada escolha está dita. Resumo: **terminar o que está
pela metade antes de acrescentar serviço novo**, e nunca misturar mudança de schema com
mudança de comportamento na mesma janela.

```
Janela 1 — inventário e backup            §2.1   🟢
Janela 2 — migrations aditivas            §3-§5  🟡   hub, opendriver, openad
Janela 3 — Asaas (dinheiro de verdade)    §6     🔴   sozinha, com teste real
Janela 4 — Infosimples                    §7     🟡
Janela 5 — infraestrutura do openad       §8     🟡   Mongo, Redis, RabbitMQ, R2
Janela 6 — deploy do openad               §9     🟡
Janela 7 — exclusão de conta a três       §10    🟡   hub + openad juntos
```

**Por que as migrations juntas na janela 2 e o Asaas separado:** as três migrations são
aditivas e não mudam comportamento de nada que esteja no ar — custam um backup só e você ganha
atribuição clara fazendo o `pg_dump` entre cada uma. O Asaas, ao contrário, troca mock por
dinheiro real em dois serviços ao mesmo tempo; ele merece janela própria, com uma transação de
teste de ponta a ponta antes de considerar concluído.

**Por que o openad por último:** ele é superfície nova. Nada do que está no ar depende dele, e
tudo o que ele precisa (o `public.users`) já existe. Fazê-lo antes de fechar o que está pela
metade só aumenta o número de coisas em voo.

---

## 2.1 Janela 1 — inventário e backup 🟢

Nenhuma escrita. O objetivo é substituir "a documentação diz" por "eu li do banco".

```bash
ssh root@179.236.228.94

# 1. Qual é o contêiner do Postgres (o documento cita l5bcr9slmgtmeefkqwg5amia — confirme)
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres

# 2. Backup completo ANTES de qualquer coisa. Guarde fora do servidor também.
PG=<nome_do_container>
docker exec $PG pg_dump -U postgres -d hub -Fc > /root/hub-$(date +%F-%H%M).dump
ls -lh /root/hub-*.dump

# 3. Snapshot do schema public, que é a linha de base de todas as comparações
docker exec $PG pg_dump -U postgres -d hub --schema-only --schema=public > /root/public-antes.sql

# 4. O que está REALMENTE aplicado, por schema
docker exec $PG psql -U postgres -d hub -c \
  "SELECT migration_name, finished_at FROM public._prisma_migrations ORDER BY finished_at;"
docker exec $PG psql -U postgres -d hub -c \
  "SELECT migration_name, finished_at FROM opendriver._prisma_migrations ORDER BY finished_at;"

# 5. O schema openad ainda não existe — confirme
docker exec $PG psql -U postgres -d hub -c \
  "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','opendriver','openad');"

# 6. Como as aplicações estão configuradas hoje
docker ps --format '{{.Names}}'
docker exec hub-backend printenv | grep -E 'PAYMENT_PROVIDER|NODE_ENV|DATABASE_URL' | sed 's/:[^@]*@/:***@/'
docker exec opendriver-backend printenv | grep -E 'PAYMENT_PROVIDER|VEHICLE_VALIDATION_PROVIDER|NODE_ENV'
```

> O usuário do Postgres pode não ser `postgres`. Confirme com
> `docker exec $PG printenv POSTGRES_USER`.

**Critério para seguir:** você tem o dump, tem o `public-antes.sql`, e sabe exatamente quais
migrations faltam em cada schema. Se a lista do passo 4 divergir do que os documentos dizem,
**pare e reavalie** — divergência aqui significa que alguém aplicou algo fora do protocolo, e o
resto deste guia assume a lista documentada.

---

## 3. Janela 2a — migrations do hub 🟡

### O que

Aplicar as migrations do hub que estão commitadas e não foram para produção. A última é
`20261002210000_push_tokens`, que cria `public.push_tokens`.

### Por que

As notificações push estão **inteiras no código** e inertes no ar: `infra/push.ts` lê
`prisma.pushToken`, e as rotas `POST|DELETE /api/v1/me/push-tokens` existem. Sem a tabela,
qualquer registro de token falha. É o item de maior retorno por menor risco do guia.

### Comandos

```bash
cd /caminho/para/hub   # clonar se não existir no servidor
git pull
cd backend
npm ci

# DATABASE_URL do hub: sem ?schema — as tabelas dele moram no public
export DATABASE_URL='postgresql://<user>:<senha>@127.0.0.1:5432/hub'
export DIRECT_URL="$DATABASE_URL"

npx prisma migrate status      # confirme o que falta ANTES de aplicar
npx prisma migrate deploy
```

### Como verificar

```bash
docker exec $PG pg_dump -U postgres -d hub --schema-only --schema=public > /root/public-depois-hub.sql
diff /root/public-antes.sql /root/public-depois-hub.sql
```

Aqui o `public` **deve** mudar — o hub é o dono. O diff tem de mostrar apenas
`CREATE TABLE "push_tokens"`, seus índices, e o token de `\restrict`. Qualquer `DROP`, qualquer
`ALTER` em tabela existente: **pare**.

Depois:

```bash
docker exec $PG psql -U postgres -d hub -c "\d public.push_tokens"
# e no app, registrar um token pelo aplicativo e conferir que a linha aparece
```

Atualize a linha de base para as próximas comparações:
`cp /root/public-depois-hub.sql /root/public-antes.sql`

### Como voltar atrás

Migration aditiva: `DROP TABLE public.push_tokens;` e remover a linha correspondente de
`public._prisma_migrations`. Como não há dado de valor ali no primeiro dia, o rollback é
barato. Depois de haver tokens registrados, não é mais — e não precisa ser, porque a tabela não
quebra nada existente.

---

## 4. Janela 2b — duas migrations do opendriver 🟡

### O que

- `20261002190000_women_only_rides` — corrida apenas mulheres
- `20261002200000_ride_for_other_passenger` — corrida para terceiros

Ambas estão commitadas; o código das duas features está **completo e já em produção**, só sem
as colunas. A segunda foi validada contra um Postgres 16 descartável, com `prisma migrate diff`
mostrando zero desvio no schema `opendriver`.

### Por que importa a ordem

Aplique na ordem dos nomes (a numeração é a ordem cronológica). O Prisma recusa aplicar fora de
ordem, mas vale saber o motivo: a segunda assume colunas da primeira.

### Comandos

```bash
cd /caminho/para/opendriver
git pull
cd backend
npm ci

# Atenção ao ?schema=opendriver: é o que mantém o histórico no schema dele
export DATABASE_URL='postgresql://<user>:<senha>@127.0.0.1:5432/hub?schema=opendriver'

npx prisma migrate status
npx prisma migrate deploy
```

Existe também `infra/deploy.sh migrate`, que faz o bootstrap e o deploy com uma confirmação
interativa (digitar `sim`). Usar o `deploy.sh` é preferível se ele já estiver configurado no
servidor, justamente porque a confirmação força a pergunta "o backup está feito?".

### Como verificar

```bash
docker exec $PG pg_dump -U postgres -d hub --schema-only --schema=public > /root/public-depois-od.sql
diff /root/public-antes.sql /root/public-depois-od.sql
```

Aqui o `public` **não deve mudar**. Única diferença aceitável: as quatro linhas do token
aleatório de `\restrict`/`\unrestrict`. Qualquer outra coisa significa que uma migration do
opendriver tocou o schema do hub — **pare imediatamente** e restaure.

```bash
docker exec $PG psql -U postgres -d hub -c \
  "SELECT migration_name FROM opendriver._prisma_migrations ORDER BY finished_at DESC LIMIT 3;"
```

Depois, no aplicativo: criar uma corrida apenas mulheres e uma corrida para terceiro, de ponta
a ponta.

### Decisões que continuam abertas

Estas **não** bloqueiam a migration, mas bloqueiam considerar a feature pronta:

- O passageiro vinculado passa a acompanhar a corrida no aplicativo dele (PIN de embarque)?
- O caminho legado `guestPassengerName` — nome em texto livre, sem CPF nem nascimento — é
  rejeitado ou mantido?
- **Jurídico:** política de transporte de menor acompanhado. O aplicativo já exige os dados;
  falta a chancela.

### Como voltar atrás

Mais caro que a do hub, porque são colunas em tabelas com dado vivo. Se o diff da §1.4
reprovar, o caminho é restaurar o dump da §2.1 — e é por isso que o backup vem antes.

---

## 5. Janela 2c — primeira migration do openad 🟡

### O que

Criar o schema `openad` com `ad_advertisers`, `ad_credit_purchases` e `ad_credit_ledger`.

### Por que pode ir na mesma janela

É schema **novo**: nada do que está no ar lê ou escreve nele. A única interseção com o existente
é uma chave estrangeira apontando para `public.users`, com `ON DELETE RESTRICT`. Risco para os
outros dois serviços: praticamente nulo.

### A pegadinha que custa uma tarde

Com `multiSchema` e o `public` já populado, o `migrate deploy` do Prisma 6 aborta com
**"migration persistence is not initialized"** — ele não consegue decidir se o banco está vazio
ou se tem um histórico que não sabe ler. O bootstrap resolve, e é idempotente.

### Comandos

```bash
cd /caminho/para/openad
git pull
# O repositório usa pnpm 10 fixado em packageManager; corepack resolve a versão sozinho
corepack enable && corepack install
pnpm install --frozen-lockfile

export DATABASE_URL='postgresql://<user>:<senha>@127.0.0.1:5432/hub?schema=openad'

# 1. Bootstrap do histórico — ANTES do primeiro deploy, idempotente
pnpm exec prisma db execute --url "$DATABASE_URL" \
  --file app/openad-api/prisma/bootstrap/001_migrations_table.sql

# 2. Migrations
pnpm exec prisma migrate deploy --schema app/openad-api/prisma/schema.prisma
```

### Como verificar

```bash
docker exec $PG pg_dump -U postgres -d hub --schema-only --schema=public > /root/public-depois-ad.sql
diff /root/public-antes.sql /root/public-depois-ad.sql     # só o token de \restrict

docker exec $PG psql -U postgres -d hub -c "\dt openad.*"
# espere: _prisma_migrations, ad_advertisers, ad_credit_ledger, ad_credit_purchases

# A trava de idempotência do IAP, que é o que impede recibo creditar duas vezes
docker exec $PG psql -U postgres -d hub -c \
  "SELECT indexname FROM pg_indexes WHERE schemaname='openad' AND indexname LIKE '%store_transaction%';"

# A FK cruzando schema, com RESTRICT
docker exec $PG psql -U postgres -d hub -c \
  "SELECT conname, confdeltype FROM pg_constraint WHERE conname='ad_advertisers_user_id_fkey';"
# confdeltype deve ser 'r' (restrict)
```

Esses quatro comportamentos eu validei localmente contra Postgres 16 com a topologia de
produção, incluindo o `pg_dump` antes e depois. Aqui é só confirmar que o ambiente real se
comporta igual.

### Como voltar atrás

Barato, porque o schema é só dele e está vazio:

```sql
DROP SCHEMA openad CASCADE;
```

### 5.3 Namespace `OpenAd:*` no catálogo do hub 🟢

Listei as 26 chaves do `CATALOG` de `settingsService.ts`: existe `OpenDriver:*`, **não existe
`OpenAd:*`**. E o `updateSetting` recusa chave fora do catálogo. Então, antes de qualquer
credencial do openad poder ser cadastrada pelo Admin → Integrações, o catálogo precisa crescer
— no repositório do **hub**.

Chaves que o openad vai precisar: a de sincronização de exclusão de conta (§10), e as de
validação de recibo das lojas quando a Fase D chegar.

---

## 6. Janela 3 — Asaas, dinheiro de verdade 🔴

**Faça esta janela sozinha.** Não a misture com migration. Ela troca mock por cobrança real em
**dois** serviços ao mesmo tempo, e o modo de falha é cobrar alguém errado.

### Checklist (9 itens do plano do opendriver)

1. No painel do Asaas, **confirmar qual ambiente** você quer: produção ou sandbox. O plano
   deixa essa pergunta explícita e ela precisa de resposta sua.
2. Admin → Integrações no hub: cadastrar `Asaas:ApiKey` e `Asaas:Environment=production`.
3. Cadastrar `Asaas:WebhookToken`.
4. No painel do Asaas, registrar o **segundo** webhook apontando para
   `https://api-app.opendriver.com.br/api/v1/payments/webhook/asaas`.
5. Backup do banco antes de virar a chave — não é migration, mas é mudança de comportamento com
   efeito financeiro.
6. Coolify: `PAYMENT_PROVIDER=mock` → `asaas` na aplicação **hub-backend**.
7. Coolify: idem na aplicação **opendriver-backend**.
8. **Redeploy das duas.** A variável é lida no boot (§1.5). Sem redeploy você fica em mock
   achando que está em produção.
9. Confirmar que `assertProductionConfig()` não lança no boot — ele recusa segredo fraco ou
   com menos de 32 caracteres.

### Teste real, obrigatório antes de declarar pronto

Uma corrida de ponta a ponta no aplicativo, ou um pagamento de teste no hub, com um valor
simbólico. Confirme nos dois lados: a cobrança no painel do Asaas e o webhook chegando e sendo
processado. Pagamento que sai mas cujo webhook não volta deixa a corrida pendente para sempre.

### Como voltar atrás

Virar `PAYMENT_PROVIDER` de volta para `mock` e redeployar. Rápido. O que **não** volta é
cobrança já feita — daí o valor simbólico no teste.

---

## 7. Janela 4 — Infosimples (CRLV) 🟡

### Precaução que vale mais que o resto

Este código **nunca foi executado contra uma placa real**. Trate a primeira execução como
teste, não como implantação.

E a cobertura é **só MT e MS** (`infosimples.ts`, `STATE_ENDPOINT`). DF e GO exigem login
GOV.BR e estão fora de escopo. Se a sua base de motoristas tem veículo de outro estado, a
validação vai falhar para eles — decida antes se isso bloqueia o cadastro ou cai num caminho
manual.

### Checklist

1. Confirmar que a conta e o plano da Infosimples cobrem os serviços usados.
2. Cadastrar `Infosimples:Token` em Admin → Integrações.
3. Coolify: `VEHICLE_VALIDATION_PROVIDER=infosimples` na aplicação do opendriver. Hoje está
   vazio, e o padrão é `mock`.
4. Redeploy.
5. Teste real: cadastrar um veículo com placa e RENAVAM reais de MT ou MS.

### Como voltar atrás

Remover a variável (volta para `mock`) e redeployar.

---

## 8. Janela 5 — infraestrutura do openad 🟡

O openad precisa de quatro coisas que **não existem em produção hoje**. Produção tem Postgres e
dois contêineres de backend; é tudo.

| Serviço | Para quê | Recomendação |
|---|---|---|
| **MongoDB 7** | operação e telemetria: frota, mídia, entrega, 28 collections | contêiner no mesmo servidor, com volume nomeado e backup próprio |
| **Redis 7** | BullMQ, cache, pub/sub do painel | contêiner, `appendonly yes` |
| **RabbitMQ 4 + plugin MQTT** | plano de dispositivo dos tabletes | contêiner; ver §1.7 antes de expor a porta |
| **Armazenamento S3** | catálogo de vídeo | **Cloudflare R2**, não disco de servidor (§1.9) |

### Opinião sobre o MongoDB

Você decidiu contêiner no mesmo servidor, e isso é razoável para começar. Duas precauções que
eu não deixaria de lado:

- **Backup separado do Postgres.** O dump da §2.1 não cobre o Mongo. Sem backup do Mongo você
  perde proof-of-play, que é o que lastreia faturamento — é o dado mais sensível do produto,
  mais que a configuração.
- **Autenticação desde o primeiro boot.** `MONGO_INITDB_ROOT_USERNAME` e
  `MONGO_INITDB_ROOT_PASSWORD` só têm efeito na **criação** do volume. Se o contêiner subir sem
  elas, acrescentá-las depois não ativa autenticação: é preciso recriar o volume. Um Mongo sem
  senha num servidor com porta exposta é comprometido em horas.

E não exponha 27017, 6379 nem 5432 para fora. Só a API fala com eles; use rede interna do
Docker.

### Verificação

```bash
docker exec openad-mongo mongosh --quiet -u <user> -p <senha> --authenticationDatabase admin \
  --eval 'db.adminCommand({ ping: 1 }).ok'
docker exec openad-redis redis-cli ping
docker exec openad-rabbitmq rabbitmq-diagnostics -q ping
docker exec openad-rabbitmq rabbitmq-plugins list | grep mqtt
```

---

## 9. Janela 6 — deploy do openad 🟡

### 9.1 O que falta no repositório antes de poder implantar

Honestidade primeiro: **não existe nenhum Dockerfile no openad.** Os únicos arquivos com esse
nome estão em `node_modules`, como template de gerador do Nx. O `docker-compose.yml` da raiz
sobe apenas infraestrutura de desenvolvimento e não tem serviço de aplicação. O `nixpacks.toml`
só fixa a versão do Node.

Então a Janela 6 começa com **trabalho de repositório**, não de servidor:

1. `Dockerfile.api` multi-estágio, espelhando o do hub: `node:22-alpine`, build, depois
   `--omit=dev` em estágio de runtime. Atenção: o `binaryTargets` do Prisma no openad já inclui
   `linux-musl-openssl-3.0.x` justamente para alpine. Se trocar a imagem base para Debian,
   troque o alvo também, senão o cliente do Prisma não carrega.
2. `Dockerfile` do portal, servindo o estático do Angular por nginx — o hub faz exatamente isso
   em `web.Dockerfile`, com `EXPOSE 8080`.
3. `docker-compose.prod.yml`, se você preferir compose ao Coolify para esta aplicação.
4. **CI:** copiar a forma do opendriver — dois `checkout` (este repositório + o do hub),
   migrations do hub primeiro, bootstrap, depois `migrate deploy` em `?schema=openad`. É o que
   garante que o CI testa contra um banco com a mesma topologia da produção. O CI do openad
   hoje só roda lint, test e build.

O README do openad cita `Dockerfile.api` e `docker-compose.prod.yml` como se existissem. É o
defeito D10, aberto desde o começo.

### 9.2 Variáveis da aplicação

As obrigatórias, com o que cada uma quebra se faltar:

```bash
NODE_ENV=production
PORT=3000

# Postgres — o ?schema=openad é obrigatório (§1.10)
DATABASE_URL=postgresql://<user>:<senha>@<host>:5432/hub?schema=openad

# Mongo — note o authSource=admin
MONGO_URI=mongodb://<user>:<senha>@openad-mongo:27017/openad?authSource=admin
MONGOOSE_AUTO_INDEX=false   # em produção, construa índice por migration, não no boot

REDIS_URL=redis://openad-redis:6379

# IDÊNTICOS aos do hub e do opendriver, mínimo 32 caracteres (§1.10)
JWT_SECRET=<o mesmo do hub>
JWT_REFRESH_SECRET=<o mesmo do hub>

# MQTT
MQTT_URL=mqtt://<user>:<senha>@openad-rabbitmq:1883
MQTT_MANAGEMENT_URL=http://openad-rabbitmq:15672
MQTT_MANAGEMENT_USER=<user>
MQTT_MANAGEMENT_PASSWORD=<senha>
RABBITMQ_PROVISION_DEVICE_MQTT_USERS=true

# Armazenamento — Cloudflare R2
S3_REGION=auto
S3_BUCKET=openad-media
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<chave R2>
S3_SECRET_ACCESS_KEY=<segredo R2>
S3_FORCE_PATH_STYLE=false

# URLs públicas e assinatura de URL de mídia
PUBLIC_API_BASE_URL=https://adsapi.opendriver.com.br
PUBLIC_ASSET_BASE_URL=https://adsapi.opendriver.com.br
ASSET_URL_SIGNING_SECRET=<segredo próprio, 32+ caracteres>

# Primeiro administrador (usado uma vez, por `nx run openad-api:seed`)
SEED_ADMIN_EMAIL=<e-mail>
SEED_ADMIN_PASSWORD=<senha forte>
```

`MONGOOSE_AUTO_INDEX=false` em produção é recomendação, não exigência: construção automática de
índice no boot de uma collection grande bloqueia a aplicação subindo. Em compensação, você
passa a precisar criar os índices explicitamente — o `IndexEnsureService` existe para isso.

### 9.3 Domínios

Você já vai criar no Cloudflare. A nomenclatura segue o padrão existente:

| Subdomínio | Para | Proxy |
|---|---|---|
| `adsapi.opendriver.com.br` | API do openad | Full (strict), **depois** do certificado emitir |
| `ads.opendriver.com.br` | portal do operador e do anunciante | idem |
| a decidir (§1.7) | MQTT dos tabletes | depende da saída escolhida |

A orientação do `infra/README.md` do opendriver vale aqui: deixe **cinza** (sem proxy) até o
certificado ser emitido, depois ligue o proxy em Full (strict). Proxiar antes faz o Let's
Encrypt falhar na validação.

### 9.4 Primeiro boot

```bash
# 1. Subir a API e conferir a saúde
curl -fsS https://adsapi.opendriver.com.br/api/health

# 2. Criar o primeiro administrador (uma vez)
pnpm exec nx run openad-api:seed

# 3. Bucket de mídia
node scripts/init-media-bucket.mjs

# 4. Entrar no portal e trocar a senha do administrador
```

### 9.5 Antes de gerar APK no servidor

Se for compilar o player lá, duas coisas:

- **`cap-sync` antes do Gradle, sempre.** `capacitor.settings.gradle` e
  `app/capacitor.build.gradle` são gerados e **não** estão versionados (D20): eles embutem o
  caminho de cada plugin dentro do store do pnpm, que varia por máquina.
- **JDK 21.** O Gradle 8.14.3 do wrapper não roda em JVM 25 ou maior. Ter "um JDK recente" não
  basta; tem de ser 17 a 24, e o Capacitor 8 compila em 21.

```bash
pnpm exec nx run openad-ad-client:cap-sync
JAVA_HOME=/caminho/jdk-21 pnpm exec nx run openad-ad-client:cap-build-android
```

---

## 10. Janela 7 — exclusão de conta a três 🟡

### O que está errado hoje

O fan-out de exclusão do hub é **par a par**. Conferi no código: as funções se chamam
literalmente `opendriverDeletionBlockers` e `purgeOpendriverAccount`, e `accountSync.ts` só
conhece `OPENDRIVER_API_URL`. Com o openad no ar, apagar uma conta no hub deixaria os dados do
anunciante vivos no openad.

Isso é LGPD, não refinamento. E é a razão de a FK do openad usar `ON DELETE RESTRICT`: o banco
**impede** a exclusão silenciosa, forçando a orquestração por HTTP. Ou seja, se vocês
esquecerem desta janela, a exclusão vai falhar com erro de chave estrangeira em vez de apagar
pela metade — falha ruidosa, que é o comportamento correto.

### O que fazer, nos dois repositórios

**No openad** — expor a superfície que o hub vai chamar:

- `GET /internal/accounts/:id/deletion-blockers` → lista vazia significa "pode excluir".
  Impedimento típico: campanha ativa com crédito não consumido.
- `POST /internal/accounts/:id/purge` → apaga os dados do schema `openad`. **Idempotente**:
  repetir não pode ser erro.
- Autenticação por `requireApiKey`, SHA-256 do bearer contra `public.service_api_keys`, igual ao
  `middleware/apiKey.ts` do opendriver. Reusa o mesmo cofre de chaves, com escopo e revogação
  pelo Admin → Chaves de API do hub.

**No hub** — generalizar o fan-out:

- `accountSync.ts` deixa de ter duas funções com `Opendriver` no nome e passa a iterar uma
  lista de participantes.
- `accountPurgeService.ts` acompanha.
- Catálogo de `settingsService.ts` ganha a chave do openad (§5.3).
- Manter o comportamento **fail-closed** que já existe: sem URL ou sem chave, a exclusão
  responde 503 em vez de prosseguir. Apagar metade de uma conta é pior que recusar.

### Como verificar

Criar uma conta de teste, torná-la anunciante no openad com uma campanha, e pedir exclusão no
hub. O resultado correto: o hub consulta os dois serviços, recebe o impedimento do openad,
e **recusa** com uma mensagem que diz o motivo. Depois de encerrar a campanha, a exclusão passa
e os dados saem dos três.

---

## 11. Critérios de aceite

Marque só o que você verificou por execução, não por leitura:

- [ ] Dump completo do banco guardado **fora** do servidor
- [ ] `public._prisma_migrations` com a última migration do hub aplicada
- [ ] `push_tokens` existe e um token real foi registrado pelo aplicativo
- [ ] `opendriver._prisma_migrations` com as 14 migrations
- [ ] Corrida apenas mulheres e corrida para terceiro criadas de ponta a ponta
- [ ] `diff` de `public` reprovou zero vezes nas janelas do opendriver e do openad
- [ ] Schema `openad` com as três tabelas, a FK em RESTRICT e o índice único de recibo
- [ ] `PAYMENT_PROVIDER=asaas` nas duas aplicações, **com redeploy**, e uma cobrança real
      confirmada nos dois lados (painel e webhook)
- [ ] Veículo com placa real de MT ou MS validado pela Infosimples
- [ ] Mongo, Redis e RabbitMQ respondendo, **com autenticação**, e nenhuma porta exposta
- [ ] Backup do Mongo configurado e testado com uma restauração
- [ ] `https://adsapi.opendriver.com.br/api/health` responde
- [ ] Primeiro administrador do openad criado e com senha trocada
- [ ] Exclusão de conta consultando os três serviços
- [ ] Keystore de release criado, com senhas, guardado em dois lugares

---

## 12. O que não entra neste corte

Para não haver dúvida sobre escopo. Está tudo em
[`plano-ecossistema-e-mobile.md`](./plano-ecossistema-e-mobile.md).

**openad, trabalho de código ainda por fazer:**

- **Fase A** — tablete em bancada. Depende de hardware, e é o único item que ainda pode
  invalidar desenho. O APK compila, nunca rodou em aparelho real.
- **Fase C** — escopo de dono em todas as rotas de mídia (hoje está em **uma**), rotas
  `/advertiser/*` e `/moderation/*` (não existem), P8, segmentação.
- **Fase D** — centavos inteiros, IAP com validação de recibo no servidor, repasse ao
  motorista. Decidido: o repasse vai para `opendriver.driver_earnings` com um valor novo de
  `EarningType`, e a liquidação acompanha o ciclo da loja (`store_cycle`), sem risco de caixa.
- **Fase E** — app do anunciante em Expo.
- **Fase F** — robustez do player. O download acumula o arquivo inteiro em memória e depois o
  converte para base64, com limite de upload em 500 MB. **Isso é bloqueio da função
  principal**, não refinamento: vai estourar memória no hardware alvo.
- **Fase H** — adapter de Redis no Socket.IO antes da segunda réplica, namespace MQTT unificado.

**Defeitos abertos:** D6 e D7 (Fase F), D9 e D11 (Fase H), D10 (§9.1), D21 (`flushall` no Redis
compartilhado entre workers do Jest).

**Fora de escopo por decisão de produto:** chamada com número mascarado no opendriver, que
exige contrato de telefonia.

---

## 13. Se algo der errado

1. **Pare.** Não tente consertar schema em produção no improviso.
2. Se o `diff` de `public` reprovou, restaure o dump da §2.1. É exatamente para isso que ele
   existe.
3. Se a aplicação não sobe depois de uma mudança de ambiente, confira primeiro se houve
   redeploy (§1.5) — é a causa mais comum e a menos lembrada.
4. Se o boot do openad reclamar de `DATABASE_URL`, provavelmente falta `?schema=openad`
   (§1.10). A mensagem de erro diz isso, de propósito.
5. Se o `migrate deploy` do openad falhar com "migration persistence is not initialized", o
   bootstrap da §5 não rodou.
