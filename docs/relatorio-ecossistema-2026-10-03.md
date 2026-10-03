# Ecossistema OpenDriver — relatório de implantação

**Data:** 3 de outubro de 2026
**Escopo:** três repositórios (`hub`, `opendriver`, `openad`) + três apps mobile, com banco
compartilhado e tudo na VPS `179.236.228.94`.

---

## 1. O que está no ar agora

Verificado **de fora**, pela internet pública (`infra/server/31-smoke-externo.ps1`):

| Domínio | Serviço | Resposta |
| --- | --- | --- |
| `hubapi.opendriver.com.br/health` | hub-backend | 200 `{"status":"ok"}` |
| `api-app.opendriver.com.br/health` | opendriver-backend | 200 `{"status":"ok"}` |
| `adsapi.opendriver.com.br/api/health` | **openad-api** | 200, com `mongodb`, `redis` e `mqtt` todos `up` |
| `ads.opendriver.com.br` | **portal do openad** | 200 |
| `hub.opendriver.com.br` | hub-frontend | 200 |
| `tiles.opendriver.com.br` | tiles | 204 |

Contêineres do openad na VPS, todos `healthy`: `openad-api`, `openad-management`,
`openad-mongo`, `openad-redis`, `openad-rabbitmq`.

**Memória:** 4,1 GB em uso de 7,8 GB, 3,6 GB disponíveis. **Disco:** 25 GB de 99 GB.

Acesso ao portal: `https://ads.opendriver.com.br`, usuário `admin@opendriver.com.br`. A senha
está em `/root/openad/.env` — leia com:

```bash
ssh opendriver 'grep SEED_ADMIN_PASSWORD /root/openad/.env'
```

---

## 2. Você precisa criar 3 registros DNS

Isto é a única coisa que me falta e que eu não posso fazer. No Cloudflare, tipo `A`,
apontando para `179.236.228.94`, com o **proxy desligado (cinza)** até o certificado emitir:

| Nome | Para quê | Sem isso... |
| --- | --- | --- |
| `mqtt.opendriver.com.br` | MQTT sobre WebSocket dos tablets | o tablete não recebe comando nem reporta veiculação |
| `storage.opendriver.com.br` | bucket público do `hub-minio` | o primeiro upload de avatar grava URL que não resolve |
| `coolify.opendriver.com.br` | painel do Coolify | você só alcança o painel pelo IP |

Depois de criar, confira a emissão:

```bash
ssh opendriver 'docker logs coolify-proxy 2>&1 | grep -i acme | tail -20'
```

E rode `powershell -File infra/server/30-dns.ps1` para conferir tudo de uma vez.

`adsapi` e `ads` **já existiam** quando eu fui verificar — obrigado, foi o que permitiu testar
de fora. `hubstorage` e `solarapi` continuam no IP antigo, como você decidiu.

---

## 3. O que eu implementei

### 3.1 Integração dos três serviços

O openad passou a existir para os outros dois. Antes desta sessão, `grep` por "openad" no hub
e no opendriver não devolvia nada.

**Exclusão de conta cruzada.** O hub é o dono da conta; cada serviço é dono do seu schema.
Quando alguém pede exclusão no hub, ele pergunta aos outros dois se há bloqueio e depois manda
purgar. Acrescentei o openad nesse leque: `backend/src/infra/accountSync.ts`
(`openadDeletionBlockers`, `purgeOpenadAccount`) e as rotas `/internal/accounts/:id/*` no
openad.

> Os bloqueadores são consultados **em paralelo** (`Promise.all`) e as purgas **em série**, com
> o hub por último. Paralelo evita somar três tempos de espera; série nas purgas porque cada
> uma é idempotente, e uma falha no meio deixa a conta viva e a operação repetível.

**Repasse ao motorista.** Quando uma veiculação é classificada como faturável, o openad credita
o motorista. A decisão foi creditar `opendriver.driver_earnings` por HTTP, e não criar carteira
no openad nem usar `public.users.cashback_balance` do hub:

- existem duas carteiras de motorista no ecossistema, e `driver_earnings` é a que ele olha —
  extrato, saldo e saque por PIX já estão prontos lá;
- `cashback_balance` é cashback de compras; misturar receita de anúncio ali inviabiliza
  separar as duas na contabilidade e na conversa com as lojas.

O openad nunca escreve no schema alheio: pede por `POST /api/v1/internal/driver-earnings/ad-revenue`,
autenticado por `public.service_api_keys`. Idempotente por `referenceId` — reprocessar um lote
de analytics **não paga duas vezes**.

**Segmentação aplicada na entrega.** `TargetingMatcherService` decide se uma campanha alcança
um veículo, combinando cidade, zona, tier e faixa horária por **conjunção**. Disjunção faria a
segmentação ser quase sempre verdadeira, e o anunciante pagaria por alcance que não pediu.

> Sem sinal de GPS, a segmentação geográfica não é avaliada e a campanha passa. Tablete perde
> sinal em túnel e garagem; tratar isso como "não alcança" tiraria do ar justamente a campanha
> segmentada onde o veículo fica parado mais tempo. O tier do veículo continua valendo, porque
> vem do cadastro.

### 3.2 Defeito que impedia qualquer anunciante de entrar

**Nenhum ponto do código criava linha em `openad.ad_advertisers`.** E
`FederatedJwtStrategy` resolve o anunciante nessa tabela e devolve `null` quando não acha. O
efeito: `/advertiser/*` respondia **401 para todo mundo, para sempre**. O app do anunciante não
sairia da tela de login.

O comentário do próprio modelo já declarava a regra ("nasce `active` [...] não existe fila de
aprovação de cadastro"). Faltava a implementação. Fiz:

- `EcosystemJwtStrategy` — valida o token do ecossistema e resolve a conta em `public.users`
  **sem** exigir o vínculo. Sem ela, a única rota capaz de criar o vínculo exigiria o vínculo
  que ela cria.
- `GET`/`POST /api/v1/advertiser/onboarding` em controlador separado. A separação é física e
  não organizacional: o principal dessa estratégia não tem `advertiserId`, então não alcança
  rota de campanha nem por troca acidental de guard.
- Idempotente, com `criado` no corpo. O app não sabe se uma tentativa anterior gravou antes da
  rede cair; distinguir por código de status faria retentativa normal parecer erro.
- Anunciante suspenso é **recusado**, não reativado — reativar por adesão daria a quem foi
  suspenso a forma de desfazer a decisão do operador.

> A adesão é uma tela e não um efeito da autenticação, porque a chamada grava cadastro de
> parceiro comercial que alimenta relatório de faturamento. Automática, transformaria qualquer
> passageiro curioso em parceiro.

### 3.3 Migrations em produção

Aplicadas pelo protocolo de 5 passos (backup → ensaio em sandbox → aplicação → diff → smoke):

| Schema | De | Para | O que entrou |
| --- | --- | --- | --- |
| `public` (hub) | 11 | 12 | `push_tokens` |
| `opendriver` | 12 | 15 | corrida só para mulheres, corrida para terceiros, `AdRevenue` |
| `openad` | 0 | 1 | schema inicial inteiro |

`pg_dump` do schema `public` ficou **byte a byte idêntico** (46.033 bytes) antes e depois das
migrations do opendriver e do openad — prova de que nenhuma delas tocou no schema do hub.

Dados preservados e conferidos: 45 usuários, 24 lançamentos de cashback, 12 corridas,
2 lançamentos de ganho de motorista.

### 3.4 App do anunciante (novo)

`app/openad-advertiser` — Expo / React Native. Fluxo completo: entrar ou criar conta, aderir
como anunciante, criar campanha, subir criativo, enviar para moderação, ver o proof-of-play.

Duas decisões carregam o desenho:

**Dois clientes HTTP sobre um armazenamento de token.** O token é emitido e renovado pelo
**hub**; o openad só valida. O cliente do openad delega a renovação ao do hub. Sem isso, um 401
do openad tentaria renovar em `/auth/refresh` do openad — rota que existe e recusa refresh
token do hub — e o anunciante seria deslogado a cada 2 horas com a sessão do hub válida.

**Quatro estados de sessão, não três:** `carregando`, `deslogado`, `precisaAderir`, `pronto`.
Conta do ecossistema não é conta de anunciante. Tratar o 401 de "ainda não aderiu" como "sessão
expirou" jogaria o anunciante de volta ao login num laço, com a senha certa.

Dinheiro converte de centavos para reais em **um** lugar (`lib/dinheiro.ts`). Não é zelo de
tipagem: a conversão espalhada foi exatamente o defeito que custou pacing errado por fator 100
na API.

### 3.5 Portal do operador

Tela de moderação de campanha de anunciante, e os dois defeitos conhecidos fechados:

- **D24** — 29 erros de lint, todos de acessibilidade real: 8 `<label>` sem `for` (leitor de
  tela anunciava o campo sem nome), 9 botões do PrimeNG sem conteúdo acessível, um `div` com
  handler de clique que não fazia nada e tornava o elemento "clicável" sem ser alcançável pelo
  teclado, e o modal do mapa que não fechava com Esc. Agora **0 erros**.
- **D26** — o teste de inventário de tablets falhava com `NG0201: No provider found for
  MessageService` na criação do componente, antes de qualquer `expect`. Agora 9 arquivos / 16
  testes verdes.

---

## 4. Defeitos que eu encontrei e corrigi pelo caminho

Estes não estavam na lista. Apareceram porque eu fui olhar o artefato em vez de confiar na
configuração.

| O que | Como aparecia | Por que importava |
| --- | --- | --- |
| `sed` corrompendo arquivo no servidor | `redis-server` virou `redis-serve`, Redis em laço de reinício | O PowerShell **remove a barra invertida** ao chamar executável nativo: o servidor recebia `s/r$//` e perdia o `r` final de **toda** linha. Afetava qualquer arquivo que eu transferisse. Trocado por `enviar.ps1`, com conferência SHA-256 dos dois lados |
| Produção atrás do `main` | hub 1 commit atrás, opendriver **3** | O webhook de deploy automático do Coolify não funciona. Nenhum dos dois tinha as rotas `/internal/*`, e a verificação fim a fim devolvia 404. Criei `24-coolify-deploy.sh`, que dispara o deploy pelo código do próprio Coolify |
| Coolify renomeia contêiner a cada deploy | `OPENDRIVER_API_URL` apontava para um nome que deixou de existir | O repasse quebraria em **todo** deploy do opendriver, e em silêncio: o cliente trata falha como "desligado", registra em log e segue. Trocado pelo domínio público |
| `MINIO_PUBLIC_URL` do hub | apontava para o domínio do **próprio backend** | O primeiro upload gravaria no banco uma URL que o backend não serve: imagem quebrada com o arquivo intacto no bucket. Hoje são 0 linhas afetadas, então era defeito latente |
| Índice único de placa | `partialFilterExpression` com `$ne` | O MongoDB **recusa** `$ne` ali, e a recusa derruba o `syncIndexes()` inteiro. A placa ficava sem restrição de unicidade, em silêncio, porque o verificador só registra aviso |
| HEALTHCHECK no caminho errado | contêiner `unhealthy` por horas com a aplicação de pé | Batia em `/health`; o caminho real é `/api/health` |
| 3 variáveis de ambiente que ninguém lê | `RABBITMQ_MANAGEMENT_*` no compose | O código lê `MQTT_MANAGEMENT_*`. Com os nomes errados, o indicador de saúde caía no padrão `127.0.0.1:15672` — o próprio contêiner da API, onde não há broker |
| `SYSTEM_ALERT_WINDOW` no APK | permissão que eu não pedi | Vinha do manifesto do `expo-dev-client`, por fusão de manifestos. É a permissão usada em golpe de sobreposição de tela, e a Play Store exige justificativa. Encontrada inspecionando o APK, não lendo configuração |
| `mqtt.subscription_ttl` | RabbitMQ em laço de reinício | Recusado desde o 3.13. Trocado por `mqtt.max_session_expiry_interval_seconds` |
| `dl.min.io` devolvendo 410 | script do MinIO abortava | A MinIO deixou de servir binário por lá. Passou a vir das releases do GitHub, com sha256 conferido |

Também conferi, por hash, que os **36 arquivos de migration** na VPS são byte a byte os do
repositório (`21-conferir-integridade.ps1`): zero divergência. O SQL aplicado em produção é o
que está versionado.

---

## 5. Decisões que eu tomei sozinho

Você pediu para eu decidir. Estas são as que mais mudam o produto, com o motivo:

**Conta MinIO dedicada ao openad, com política mínima.** Rejeitei reusar a chave do hub (deu
`AccessDenied` em `openad-media`) e rejeitei usar a credencial de raiz. Raiz num serviço de
aplicação dá a ele poder de apagar `hub-uploads` e `opendriver-private`, que guardam documento
de motorista e comprovante. Um erro de código no openad não deve poder destruir dado dos outros
dois. Conferido nos dois sentidos: escreve no próprio bucket, **não** alcança os outros.

**`storage.opendriver.com.br` só serve `/hub-uploads/`.** A regra do Traefik exige o prefixo.
Sem ele, o domínio exporia `opendriver-private` e `openad-media` inteiros.

**Portal servido como estático pelo nginx, não SSR.** É ferramenta interna atrás de login, sem
nada a indexar. Um processo Node a menos numa VPS de 2 vCPU.

**Imagens construídas aqui e transferidas, não construídas na VPS.** O build do Angular passa
de 2 GB de heap em pico; com 2 vCPU e ~4 GB livres, isso convida o OOM killer — e ele escolhe o
processo maior, que é o **Postgres compartilhado pelos três serviços**. Compilar lá seria
arriscar produção para economizar uma transferência.

**`ECOSYSTEM_SERVICE_API_KEY` sem obrigatoriedade no boot.** A ausência degrada o repasse (que
é recuperável pela conferência em `/internal/ads/payouts`), não impede o serviço de subir.
Exigir a chave trocaria uma degradação visível e reversível por um serviço que não sobe.

**Migrations não rodam no boot do contêiner.** Migration em banco compartilhado por três
serviços é operação deliberada, com backup e diff antes e depois. Um contêiner que migrasse no
boot aplicaria schema novo sem ninguém olhando, e repetiria isso em cada reinício automático.

**Campanha de anunciante nasce em `draft`, não em `pending_review`.** O plano dizia o
contrário. Criar já em revisão colocaria na fila do moderador uma campanha sem criativo nenhum:
ele aprovaria uma casca, e a ativação falharia depois com um erro sobre agendamento que nada
tem a ver com o que ele acabou de decidir.

**Supressão por segmentação vai para contador Prometheus, não para evento por item.** Um
documento por campanha suprimida seriam frota × campanhas escritas a cada 15 minutos, para um
dado que ninguém lê evento a evento. `campaignId` **não** entra como rótulo: cardinalidade alta
derruba Prometheus. Vai no log estruturado.

---

## 6. O que foi verificado, e como

Nada aqui é "o comando não deu erro".

| Verificação | Resultado |
| --- | --- |
| `infra/server/22-smoke-openad.sh` | 5 contêineres `healthy`, `/api/health` 200 com as 3 dependências `up`, zero aviso de índice, login do admin fechando, `/internal/*` recusando sem chave e respondendo com chave, Postgres no schema certo, MinIO acessível pela conta restrita |
| `infra/server/23-fim-a-fim.sh` | Token **emitido dentro do contêiner do hub** autentica em `/advertiser/*` do openad; adesão cria e é idempotente; `/advertiser/campaigns` vai de 401 para 200; repasse grava `AdRevenue` de R$ 0,37 em `driver_earnings` e **não** duplica na repetição; bloqueadores de exclusão 200 nos dois serviços. Tudo limpo no fim: 45 usuários, 2 ganhos, 0 anunciantes — como antes |
| `infra/server/31-smoke-externo.ps1` | cada domínio chega ao serviço certo, pela internet |
| `openad-api` | 111 suítes / 400 testes, lint 0 erros |
| `openad-management` | 9 arquivos / 16 testes, lint 0 erros, `build` passando |
| `hub` backend | `npm run build` + 9 arquivos de teste |
| `opendriver` backend | `typecheck` + 7 arquivos de teste |
| app do anunciante | 60 testes, `typecheck` e lint limpos, `expo export` fechando, APK inspecionado |
| `hub-mobile` | `typecheck`, 8 testes, lint limpo |
| `opendriver/mobile` | `typecheck`, 33 testes, lint limpo |

---

## 7. Mobile

Os três apps. `hub-mobile` e `opendriver/mobile` **já apontavam** para os domínios da VPS nova
— os nomes não mudaram, só os IPs — então não houve o que reconfigurar, apenas validar e
compilar.

| App | Pacote | Estado |
| --- | --- | --- |
| `openad-advertiser` (novo) | `br.com.opendriver.ads` | APK gerado: 105,8 MB, targetSdk 36, sem permissão indevida, `adsapi.` e `hubapi.` embutidos |
| `hub-mobile` | `br.com.opendriverhub.app` | validado; APK compilando |
| `opendriver/mobile` | `br.com.opendriver.app` | validado; APK na fila |

Para gerar de novo:

```powershell
# app do anunciante
cd app\openad-advertiser; .\scripts\apk.ps1 -Variante preview

# os outros dois, em série
powershell -File infra\server\32-apks-mobile.ps1
```

Os 105,8 MB são de APK universal, com as quatro arquiteturas juntas — conveniente para
instalar em qualquer aparelho de teste. Para a loja, o perfil `production` do `eas.json` gera
AAB, e a Play Store entrega por arquitetura (fica em torno de 30 MB por aparelho).

O build precisa de JDK 21 (`D:\dev\jdk\jdk-21.0.12.1+1`) e do SDK em `D:\dev\android-sdk`. O
JDK 26 que está no `PATH` é recusado pelo Gradle do React Native; os scripts já apontam para o
certo.

---

## 8. O que ainda falta

**Seu, e só seu:**

1. Os **3 registros DNS** da seção 2.
2. **Rotacionar a senha root da VPS.** Você me passou duas senhas por aqui; elas não foram
   necessárias (a chave `id_ed25519` já estava autorizada) e eu não as usei em nenhum momento.
   Mesmo assim, trocá-las é o certo.
3. **Desligar autenticação por senha no SSH**, agora que a chave funciona:
   ```
   # /etc/ssh/sshd_config
   PasswordAuthentication no
   PermitRootLogin prohibit-password
   ```
   Isso remove a classe inteira de ataque de força bruta na porta 22.

**Meu, e reconhecidamente não feito:**

4. Os dois APKs restantes estão compilando. Vou confirmar quando terminarem.
5. **Arte final dos ícones** do app do anunciante. Os `assets/*.png` são placeholder
   funcional (quadrados na paleta do produto) gerados por `npm run icones` — existem porque
   `expo prebuild` falha sem eles. Substituir mantendo nomes e tamanhos.
6. **O repasse nunca rodou com dado real de veiculação.** Eu provei o caminho inteiro com um
   lançamento sintético de 37 centavos, que depois removi. A primeira veiculação de verdade
   ainda não aconteceu, porque não há tablete em campo nem campanha ativa.
7. **Defeitos conhecidos e não tratados nesta sessão**, por estarem fora do caminho de subir:
   - D6/D7 — o player baixa mídia em memória e tem dois gerenciadores de cache;
   - D9 — Socket.IO sem adapter Redis (impede mais de uma instância da API);
   - D11 — namespace MQTT partido entre duas convenções;
   - 2 avisos de `non-null assertion` no portal.

---

## 9. Commits

| Repositório | Commits desta sessão | Estado |
| --- | --- | --- |
| `openad` | `6b9ee49`, `4fad604`, `54f2708`, `93a5831`, `063fcde` | último ainda local |
| `hub` | `3854400` | enviado |
| `opendriver` | `8d81d65` | enviado |
| `hub-mobile` | — (sem alteração) | — |

Depois dos pushes, `hub-backend` e `opendriver-backend` foram redeployados pelo Coolify e estão
rodando as imagens dos commits novos.

---

## 10. Scripts de operação

Tudo o que eu fiz no servidor está em `infra/server/`, numerado na ordem de execução e
comentado com o motivo de cada decisão. Os que você mais vai usar:

| Script | Para quê |
| --- | --- |
| `enviar.ps1` | transferir arquivo com conferência de hash — **use este**, não `scp` solto |
| `22-smoke-openad.sh` | "o openad está bem?" |
| `23-fim-a-fim.sh` | "os três serviços conversam?" (cria e remove dado de teste) |
| `24-coolify-deploy.sh <uuid>` | redeploy pelo Coolify |
| `30-dns.ps1` | quais nomes faltam criar |
| `31-smoke-externo.ps1` | cada domínio chega ao serviço certo, visto de fora |
| `32-apks-mobile.ps1` | APK do `hub-mobile` e do `opendriver/mobile` |

O `openad-pg-sandbox`, que usei para ensaiar as migrations, foi removido — `07-sandbox.sh`
recria em minutos se precisar ensaiar de novo.

---

## 11. Uma coisa que eu quero deixar explícita

Duas vezes nesta sessão eu quebrei algo e só descobri porque fui conferir o artefato em vez de
confiar no comando:

- o `sed` que corrompeu o `docker-compose.prod.yml` e derrubou o Redis — `scp` não reclamou,
  o arquivo chegou inteiro e **depois** foi estragado;
- a permissão `SYSTEM_ALERT_WINDOW` no APK — nenhuma leitura de configuração mostraria,
  porque ela entrou por fusão de manifestos de uma dependência.

Por isso os scripts que eu deixei conferem o resultado e não o código de saída: hash dos dois
lados, `aapt2 dump badging` no APK, busca do domínio esperado dentro do bytecode, `pg_dump`
antes e depois. Vale desconfiar na mesma medida de qualquer coisa aqui que eu tenha afirmado
sem mostrar como verifiquei.
