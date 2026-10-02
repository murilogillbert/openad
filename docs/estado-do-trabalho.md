# OpenAD — estado do trabalho e pendências

> Documento de passagem, escrito em 2026-10-02 para troca de máquina.
> O plano completo está em [`plano-implementacao.md`](./plano-implementacao.md); aqui fica
> só o que já foi feito, o que está pendente e como subir o ambiente de novo.

---

## 1. Como montar o ambiente na máquina nova

Nada disso está no `README` do projeto, e dois itens não funcionam como documentado.

```
# 1. Node e pnpm
#    O repositório divergia em três lugares (.nvmrc 20.19, nixpacks 22.17, engines 20/22/24).
#    Validado com Node 24.16 e pnpm 10.34. Não há campo `packageManager`.
npm install -g pnpm@10
pnpm install --frozen-lockfile

# 2. Infraestrutura local
#    NÃO use `pnpm docker:up`: ele passa por `scripts/with-monorepo-env.sh`, que é bash e
#    não roda no Windows (só existe o bash do WSL, que não resolve caminho do host).
docker compose --env-file docker/.env.dev up -d

# 3. Bucket de mídia
node scripts/init-media-bucket.mjs

# 4. Testes
$env:NODE_ENV='test'; pnpm exec nx run openad-api:test
pnpm exec nx run openad-ad-client:test
```

Portas do stack: Mongo 27017, Redis 6379, MQTT 1884, RabbitMQ management 15672,
S3 9000, UI do filer 9001. API em 3000, portal em 4200.

**Armadilhas conhecidas deste ambiente:**

- O `docker-compose.yml` original fixava `minio/minio:RELEASE.2025-04-22T22-12-26Z`, que
  **não é mais puxável** (Docker Hub nega, `quay.io/minio/minio` responde 401, `bitnami`
  saiu do catálogo gratuito). Como o compose puxa em paralelo e aborta no erro, Mongo,
  Redis e RabbitMQ também não subiam. Trocado por SeaweedFS, mesma API S3, mesma porta,
  mesmas credenciais — nenhum `.env` mudou. Produção usa Cloudflare R2, não é afetada.
- **Não é possível gerar o APK**: a máquina anterior tinha apenas **JRE 1.8**, e o wrapper
  pede Gradle 8.14.3 com AGP que exige **JDK 17+**. Instalar um JDK 17 é pré-requisito para
  qualquer validação em tablete.
- Se um teste de MQTT falhar com `waitUntil timeout`, costuma ser estado residual de uma
  execução interrompida. `docker restart openad-rabbitmq` resolve.

---

## 2. O que já foi entregue

Commits em `main`, do mais antigo para o mais recente:

| Commit | O que é |
|---|---|
| `ec9c707` | Baseline do código de terceiros, sem nenhuma alteração nossa (1114 arquivos). O repositório não tinha commit algum. |
| `382e331` | Stack local volta a subir (MinIO → SeaweedFS) + `init-media-bucket.mjs` portável. |
| `5e7d71b` | Plano de adaptação, integração e mobile. |
| `324cc57` | Decisões fechadas: IAP, repasse com piso e leilão, player em Capacitor. |
| `41c6184` | **D13** — typecheck quebrado impedia `build` e `test` do player. |
| `f2a3fc1` | **Fase 1** — liga a entrega de mídia e o envio de analytics no player. |
| `6f74af6` | Guardas de regressão: fiação do bootstrap e serialização da sincronização. |
| `9de9e3d` | Documenta D13 e D14. |
| `3bbc808` | **D15** — zera os cinco erros de lint pré-existentes da API. |
| `4765952` | Remove a geração 2 do pipeline de manifesto no servidor. |
| `79ed067` | **Fase 2** — manifesto seleciona por campanha, janela e orçamento. |
| `e0c3b03` | Documenta Fase 1 e Fase 2 concluídas. |

### Fase 1 — fazer o player tocar (feita, exceto hardware)

O player tinha **três gerações** de pipeline de entrega empilhadas, e a correta estava
desligada: `SyncOrchestratorService.syncNow()` não tinha nenhum chamador. As duas obsoletas
baixavam os bytes e os descartavam sem gravar arquivo, e ainda registravam no índice de
cache arquivos inexistentes.

Também: a rota `/playback`, onde vive o `<video>`, era **inalcançável** — não existe nenhuma
navegação no app, e a rota padrão caía em `pairing`. E `PlayBatchUploaderService` estava
declarado como provider sem que nada o injetasse, então nada de analytics saía do tablet.

Resolvido com `PlayerShellComponent` (estado em vez de rota), `SyncSchedulerService` (boot,
pareamento, 15 min, volta de rede, comando MQTT, tudo serializado num único *in-flight*) e
`start()` explícito no uploader. `SYNC_SCHEDULE` passou a sincronizar de fato — antes
respondia ack de sucesso e não fazia nada. A telemetria deixou de ser ficção: vinha da regra
de maior prioridade do schedule retido, com `campaignId: "rule:{ruleId}"`.

Corrigidos no caminho, porque ligar o pipeline sem eles seria pior do que deixá-lo
desligado: **D14** (rebaixava o catálogo inteiro a cada sincronização — dezenas de GB/dia por
tablet) e **D8** (buffer de analytics quadrático, trocado por NDJSON com append;
`markUploaded` passou a remover as linhas enviadas, que antes seguiam ocupando o teto e
faziam o corte descartar registros ainda **não** enviados).

### Fase 2 — seleção correta de manifesto (feita)

O gerador fazia `find({ isActive: true })` sobre toda a mídia da plataforma. Campanha em
rascunho, encerrada, vencida ou com orçamento diário esgotado continuava sendo distribuída —
o pacing já era calculado em `campaign_daily_spend` e ninguém consultava.

`CampaignEligibilityService` resolve por status `active`, janela contratada e
`pacingState != 'paused'` (`near_cap` segue apto de propósito: desacelera, não para). A
prioridade passou a vir de `campaigns.priority` em vez da posição na lista — é ela que o
player usa para decidir o que descartar quando o armazenamento aperta.

### Estado de qualidade verificado por execução

| | Antes (baseline recebida) | Agora |
|---|---|---|
| `openad-api:test` | 97 suítes, 270 testes | 97 suítes, 276 testes |
| `openad-api:lint` | **5 erros** | 0 erros |
| `openad-ad-client:test` | **não compilava** | 29 arquivos, 73 testes |
| `openad-ad-client:lint` | 0 erros | 0 erros |

No estado recebido **nenhum dos dois alvos de qualidade passava**: o lint da API falhava e o
build/test do player não rodava. O que havia de verde era a suíte da API, e só.

---

## 3. Fase 3 — em andamento, no último commit

> **Atenção na retomada:** esta leva foi commitada com typecheck limpo (app e spec), mas a
> suíte completa da API **não terminou de rodar** antes da troca de máquina. O primeiro
> comando na máquina nova deve ser `pnpm exec nx run openad-api:test`.

Entregue nesta leva:

**Decisão de caixa do repasse (R3), aplicada como recomendado.** Bloco `monetization` novo em
`platform_config`, com `driverPayoutMinPercent` (piso), `driverPayoutAuctionWeight` (o `k` do
leilão, `0` desliga), `driverPayoutSettlement` e `storeCycleSettlementDays`. O padrão é
`store_cycle` — sem risco de caixa — e ligar a antecipação é um clique no painel, não um
deploy. A razão é a §2.1c do plano: a receita de IAP chega 30 a 45 dias depois, então o
motorista veicula hoje e a plataforma só tem o dinheiro depois.

**Schema (tudo aditivo, nenhuma coluna existente alterada):**

- `campaigns`: `ownerUserId` (→ `public.users.id`), `advertiserId`, `orderId`, subdocumentos
  `moderation`, `targeting` e `driverPayout`, e dois índices novos (listagem do anunciante e
  fila de moderação).
- `campaigns.status`: `+pending_review`, `+rejected`.
- `media_assets`: `ownerUserId` + índice.
- `users.role`: `+content_moderator`, e a lista de papéis internos passou a vir de
  `INTERNAL_USER_ROLES` em `@openad/domain` em vez de um enum literal duplicado no schema.
- `lost_opportunity_events.reason`: `+revenue_share`, também no contrato Zod de MQTT — sem
  isso a ingestão rejeitaria o evento de supressão por leilão.

**Moderação com máquina de estados.** `campaign-status.policy.ts` substitui o "aceita
qualquer destino do enum" que permitia ir de `draft` direto a `active`, sem revisão.
`pending_review → active` é a única porta para o ar, e só `content_moderator` ou
`super_admin` a abrem — gerente de campanha não aprova a própria campanha. Recusa exige
motivo, registrado em `campaigns.moderation`.

**Isolamento por dono.** `MediaScopeService` era um stub que devolvia `true` e — pior —
**nunca era chamado**. A regra agora vive em `auth/access-scope.ts` como função pura
(`ownerFilterFor`), porque `campaigns` e `media-ingestion` precisam dela e um serviço
injetável criaria ciclo entre os módulos. `GET /campaigns` passou a filtrar na consulta, não
depois: escopar em memória faria a primeira página de um parceiro vir vazia porque foi
preenchida com registros de outro e descartada.

**Fixture de configuração.** Quatro specs mantinham cópias literais do objeto
`PlatformConfig` e todas quebraram ao acrescentar `monetization`. `defaults()` virou a função
pura `platformConfigDefaults()`, e os specs partem dela com *spread*.

### O que falta da Fase 3

1. **Identidade federada.** `JwtStrategy` precisa aceitar dois tipos de token com o **mesmo**
   `JWT_SECRET` do ecossistema: equipe interna (`sub` em `openad.users`, como hoje) e
   anunciante (`sub` = `public.users.id`, resolvido para `public.ad_advertisers`). Sem isso
   o isolamento por dono já existe mas nunca é exercitado, porque todo token atual é interno.
2. **Rotas do anunciante** (`/api/v1/advertiser/*`) e **de moderação**
   (`/api/v1/moderation/*`) — listadas na §4.3 do plano.
3. **Tabelas em `public`** (`ad_advertisers`, `ad_credit_purchases`, `ad_credit_ledger`,
   `ad_payouts`): **são do repositório `hub`**, onde eu não tenho permissão para mexer.
   Precisa ser feito lá, como migration aditiva, seguindo o protocolo de backup.
4. **Escopo por dono nas rotas de mídia** (`/media`, `/media/vfs/*`): a função pura está
   pronta, falta aplicá-la nos controllers de mídia.
5. **Dinheiro em centavos inteiros** (P2 da padronização). `campaigns.budget.totalAmount` é
   float e `campaign_daily_spend` já conta em `billableCostCents` — o serviço já é
   inconsistente consigo mesmo. A conversão toca pacing, reconciliação, relatório de
   faturamento, DTOs e o portal Angular; merece commit próprio pelo risco de regressão.

---

## 4. Pendências por fase

| Fase | Estado | O que falta |
|---|---|---|
| 0 — Ambiente | feita | `Dockerfile.api` e `docker-compose.prod.yml` (citados no README, **não existem**); CI no GitHub Actions; fixar versão de Node (D12) |
| 1 — Player toca | feita no código | Rodar em tablete e exercitar o watchdog. Exige JDK 17 |
| 2 — Manifesto | feita | Segmentação por device/veículo/zona, que depende de `campaigns.targeting` — o campo já existe no schema, falta o gerador consumi-lo e `deviceState` deixar de ser ignorado |
| 3 — Identidade e isolamento | em andamento | §3 acima |
| 4 — Moderação | parcial | Máquina de estados e papel prontos; faltam a fila (`GET /moderation/queue`), a decisão por rota própria e as telas no portal |
| 5 — Crédito, IAP e repasse | não iniciada | Validação de recibo no servidor (App Store Server API, Google Play Developer API), notificações de servidor das duas lojas, débito amarrado ao pacing, `boostRepasse` no score da arbitragem, `GET /internal/ads/payouts` |
| 6 — App do anunciante | não iniciada | Projeto Expo novo. SKUs de IAP cadastrados nos dois consoles antes da primeira build de review |
| 7 — Robustez do player | não iniciada | `Filesystem.downloadFile` em vez de buffer em memória + base64 (D6); um gerenciador de cache só, com espaço livre real (D7); religar janelas de sincronização; validar H.265 em WebView |
| 8 — Escala | não iniciada | Adapter de Redis no Socket.IO (D9); unificar namespace MQTT (D11) |

---

## 5. Decisão aberta: trocar o player de Capacitor para Expo

Pedido em 2026-10-02: *"troca do java para expo, não vou seguir com essa linguagem"*.

Preciso registrar uma correção factual antes de executar, porque ela muda a conta:
**migrar para Expo não elimina o Java.**

O que os 4 arquivos nativos fazem (373 linhas, em
`app/openad-ad-client/android/app/src/main/java/com/openad/`):

| Arquivo | Função | Existe API JS? |
|---|---|---|
| `MainActivity.java` | Allowlist de Lock Task e `LOCK_TASK_FEATURE_NONE` quando o app é Device Owner — kiosk sem UI de sistema | Não |
| `OpenAdDeviceAdminReceiver.java` | Receiver DPC que torna possível `dpm set-device-owner` | Não |
| `OpenAdSilentInstallPlugin.java` | Autoatualização de APK via `PackageInstaller`, sem confirmação | Não |
| `PowerStatePlugin.java` | Detecção de motor ligado/desligado | Parcial |

`DevicePolicyManager` e `PackageInstaller` não têm binding em JavaScript, nem no React
Native nem no Expo. Para fazer isso em Expo é preciso escrever um módulo nativo e embalá-lo
num config plugin — **em Java ou Kotlin**. A migração relocaliza o código nativo e acrescenta
a troca de framework por cima; não remove a linguagem.

Três caminhos, com custo honesto:

**A — Capacitor + reescrever os 4 arquivos em Kotlin.** Satisfaz "não quero Java", é o padrão
moderno do Android, e plugin Capacitor aceita Kotlin sem nenhuma mudança de framework. Custo
estimado: 2 a 3 dias. Risco baixo, nenhum plugin perdido.

**B — Migrar para Expo (bare/prebuild) + config plugin próprio.** Entrega um stack mobile só
no ecossistema. Custo: as 19 dependências Capacitor hoje integradas precisam de substituto
ou reescrita — kiosk, brilho, sensor de luz, bússola, acelerômetro, wifi, volume, privacy
screen, keep-awake, MQTT nativo, background task, filesystem, geolocation, preferences,
device, network, app, fullscreen, volume control. Semanas, não dias. E ainda sobra código
nativo em Kotlin.

**C — Manter como está.** Zero custo, mas o Java fica.

**Minha recomendação é A**, por isto: o objetivo declarado é a linguagem, e A resolve a
linguagem pelo menor custo. B só se paga se o objetivo real for unificar o stack mobile — e
nesse caso vale decidir sabendo que são semanas e que o nativo não desaparece.

Não executei nenhum dos três. Precisa da sua escolha.

---

## 6. Catálogo de defeitos encontrados

Quinze, numerados no plano. Onze corrigidos, quatro pendentes.

| # | Defeito | Estado |
|---|---|---|
| D1 | Três gerações de pipeline; a correta sem chamador | corrigido |
| D2 | Rota do player inalcançável | corrigido |
| D3 | Uploader de analytics nunca instanciado | corrigido |
| D4 | Manifesto sem filtro de campanha, janela ou orçamento | corrigido |
| D5 | Sem isolamento por dono | corrigido no código, falta exercitar com token de anunciante |
| D6 | Download de vídeo acumulado em memória + base64 | **pendente** (Fase 7) |
| D7 | Dois gerenciadores de cache concorrentes; espaço livre falso | **pendente** (Fase 7) |
| D8 | Buffer de analytics quadrático, com perda silenciosa | corrigido |
| D9 | Socket.IO sem adapter de Redis | **pendente** (Fase 8) |
| D10 | Sem caminho de deploy versionado | **pendente** (Fase 0) |
| D11 | Namespace MQTT partido em dois | **pendente** (Fase 8) |
| D12 | Versão de Node divergente em três lugares | **pendente** (Fase 0) |
| D13 | Typecheck quebrado impedia build e test do player | corrigido |
| D14 | Rebaixava o catálogo inteiro a cada sincronização | corrigido |
| D15 | Lint da API falhava na baseline | corrigido |

---

## 7. Nada foi aplicado em produção

O `hub` está no ar e **não foi tocado**. Nenhuma migration foi aplicada em produção. As
tabelas em `public` da §3 precisam ser criadas no repositório `hub`, seguindo o protocolo de
backup de `opendriver/docs/plano-producao-final.md`.
