# Pendências do ecossistema OpenDriver

Documento **incremental**: itens novos entram no fim, e o status ao lado do título muda de
`Pendente` para `Concluído` quando o item fecha. Nada é apagado — uma pendência resolvida vale
como registro do que foi feito e de quando.

O que entra aqui: o que **depende de uma ação externa** ou de uma decisão que não é minha —
credencial de terceiro, permissão em console de loja, aparelho físico, decisão de custo. O que é
só trabalho de código vive no `plano-v2-ecossistema.md`, não aqui.

Última revisão: 2026-10-08 (itens 12 e 13 acrescentados: migrations ensaiadas e à espera de
autorização para produção; tablete bloqueado por PIN).

---

## 1. Verificar a validação dos veículos na Infosimples e habilitar autenticação via gov.br — **Pendente**

### O que já está pronto

A classificação automática de veículo está em produção desde 08/10/2026 (commits `20b0955`,
`c370430`, `5b7f1bf`). Em produção existem 4 UFs cadastradas em `opendriver.detran_providers`,
137 regras de marca/modelo em 28 marcas, e as rotas de operador no painel do hub, em
`/admin/opendriver/categorias-veiculos`.

O token da Infosimples está cadastrado em `integration_settings` como `Infosimples:Token`
(40 caracteres, gravado em 08/10 08:44).

### O que falta, e por quê

**1. A consulta ao Detran ainda não acontece de verdade.**
`VEHICLE_VALIDATION_PROVIDER` não está definida em nenhum dos dois backends, e o padrão é
`mock`. O mock **ecoa** marca, modelo e ano que o motorista digitou — o que exercita a tabela de
regras, mas não descobre nada. Enquanto estiver assim, a classificação trabalha sobre
autodeclaração com uma camada de regra em cima.

Ligar o provedor real é uma variável de ambiente, e passa a **gastar crédito da Infosimples a
cada cadastro de veículo**. É decisão de custo, por isso está aqui e não foi feita sozinha.

**2. O caminho do serviço do DF nunca foi confirmado por consulta real.**
O `detran-df-veiculo` foi descontinuado quando o site oficial mudou. O substituto indicado é
`detran/df/veiculo-mobile`, que é o que está cadastrado — mas **o endereço não foi verificado**.
Não dá para verificar de graça: sem token a Infosimples responde
`601 não foi possível se autenticar` **antes** de validar a rota, então um 601 não distingue
endereço errado de credencial ausente. E varrer endereços com token válido poderia gerar
cobrança por consulta executada.

**3. GO está desativado por falta de credencial gov.br.**
O serviço de Goiás exige **login do gov.br (CPF + senha) ou certificado digital A1**, ao
contrário de MT, MS e DF, que aceitam só placa + RENAVAM. Enquanto a credencial não existir, GO
fica `active = false`, e veículo de GO cai em revisão manual com motivo explícito
(`uf_com_consulta_desativada`) em vez de falhar calado.

A estrutura para receber a credencial já está pronta: o provedor de GO aponta para as chaves
`Infosimples:GoLoginCpf` e `Infosimples:GoLoginSenha`. **O valor nunca é guardado em
`detran_providers`** — só o nome da chave — para segredo continuar num lugar só, que é
`integration_settings`, já mascarado na leitura e fora da auditoria.

### Como fechar

Na ordem, porque cada passo informa o seguinte:

1. **Testar MS e MT**, que são os formatos já exercitados em código. Painel do hub →
   `/admin/opendriver/categorias-veiculos` → aba **Consulta por UF** → botão **Testar**, com uma
   placa e um RENAVAM reais. A resposta crua aparece na tela, e o resultado fica gravado em
   `last_probe_result` para consulta posterior sem abrir log de servidor.
   > O botão funciona com o provedor ainda em `mock`: ele chama a consulta direta, não o
   > provedor de cadastro. Isso é de propósito — é o resultado do teste que dá confiança para
   > ligar o provedor real, então exigir o provedor ligado inverteria a ordem.
2. **Testar DF.** Se vier `404` ou resposta que não é JSON, o endereço está errado: corrigir no
   mesmo lugar (botão Editar) e testar de novo. Nenhum deploy é necessário.
3. **Ligar o provedor real**, depois que MS, MT e DF responderem. Em Integrações, ou pela
   variável `VEHICLE_VALIDATION_PROVIDER=infosimples` nos dois backends.
4. **Obter a credencial do gov.br para GO** — CPF e senha de uma conta gov.br, ou certificado A1.
   Cadastrar em Integrações com as chaves `Infosimples:GoLoginCpf` e `Infosimples:GoLoginSenha`,
   e então marcar GO como ativo na aba Consulta por UF.
5. **Reclassificar a frota** depois que as consultas reais começarem a responder: aba
   Divergências → **Simular**, conferir a lista, e então **Aplicar**. Isso usa o retorno do
   Detran já guardado em cada veículo e **não consome crédito**.

### Risco de não fechar

A categoria do veículo define a tarifa. Enquanto a consulta for mock, a regra decide sobre o que
o motorista declarou — ou seja, continua possível cadastrar um Mobi como Conforto e a regra
apenas confirma o texto digitado. A proteção que existe hoje é a política de "a menor categoria
vence", que impede cobrar Conforto de quem declarou Econômico; ela não substitui o dado real.

---

## 2. Token do Asaas e saída do provedor de pagamento simulado — **Pendente**

### O que já está pronto

A integração com o Asaas é real e completa nos dois backends: tokenização de cartão, Pix com QR,
split por carteira de parceiro no hub, e webhook que **reconsulta o status no Asaas** em vez de
confiar no corpo recebido. As credenciais entram pela tela de admin (`integration_settings`) e
valem na hora, sem redeploy.

### O que falta

**1. As chaves do Asaas não existem em produção.** Conferido em 08/10: `integration_settings`
tem `Infosimples:Token`, `Internal:AccountSyncKey`, `OpenAd:ApiUrl`, `OpenAd:EarningKey`,
`Email:*` e `Survey:*`. **Não tem** `Asaas:ApiKey`, `Asaas:WebhookToken` nem
`Asaas:Environment`.

**2. `PAYMENT_PROVIDER=mock` nos dois backends.** O gateway mock gera um QR falso
(`https://mock.local/pix/...`) e **aprova sozinho depois de 5 minutos**. Existem só 2 pagamentos
de corrida no banco, ambos `mock`, de 01/10 — então **nenhum cliente real pagou nada**. É
defeito latente, não incidente.

### Como fechar

1. Cadastrar `Asaas:ApiKey`, `Asaas:WebhookToken` e `Asaas:Environment` em Integrações.
2. Começar com `Asaas:Environment=sandbox` e um pagamento de teste ponta a ponta.
3. Trocar o provedor para `asaas`. Com a Frente B do plano v2, isso passa a ser chaveável pela
   tela; antes dela era variável de ambiente lida no boot, que exigia redeploy.

### Risco de não fechar

O pior modo de falha possível aqui é descobrir semanas depois que nenhum pedido foi pago de
verdade. Por isso a Frente B inclui um aviso visível no admin quando o provedor ativo é `mock`:
hoje a diferença entre "cobrou" e "fingiu que cobrou" não aparece em lugar nenhum da interface.

---

## 3. Permissão de ver compras financeiras no Play Console — **Pendente**

Só se passar a existir compra de crédito **dentro** do app do anunciante.

Pela decisão de 07/10 (PDF de monetização), a compra de crédito é no **painel web, por Pix**, e o
app do anunciante fica só de gestão. Com isso a validação de recibo de loja sai do escopo, e esta
pendência fica em suspenso — registrada porque a decisão pode mudar.

Se mudar: a conta de serviço `publicador-eas@lateral-pillar-454914-g5` já existe e já é usada
pelos scripts de publicação, com escopo `androidpublisher`. Falta conceder a permissão de **ver
compras financeiras** no Play Console e reaproveitar o mesmo JWT.

---

## 4. Provar a retomada de download num tablet real — **Pendente**

O tablet está descarregado (informado em 08/10), então os testes que exigem o aparelho estão
parados.

O app foi escrito para retomar download interrompido, e o manifesto já entrega URL pré-assinada
direto do storage. **Ninguém verificou que a retomada retoma.** Ela depende de duas coisas que
não se verificam lendo código:

- **CORS do storage.** Sem `Access-Control-Expose-Headers: Content-Range` em
  `storage.opendriver.com.br`, a leitura do `Content-Range` devolve `null`, o laço pede
  `bytes=<tamanho>-`, recebe `416` e **recomeça do zero**. Nada falha visivelmente: o vídeo é
  baixado de novo por inteiro e a "retomada" não retoma.
- **Validade da URL.** A URL do manifesto vale 1 h. Uma retomada depois disso usa URL vencida.

A parte que **não** depende do tablet (conferir o CORS por `curl` e tratar `403` como URL
vencida) está na Frente F do plano e é feita sem o aparelho. O que precisa do tablet é cortar a
rede no meio de um download grande e observar se o pedido seguinte sai com `Range` e volta `206`
com `Content-Range` legível.

---

## 5. Sinal de "corrida iniciada" chegando ao tablet — **Pendente**

Decisão 5 do PDF de monetização: os anúncios **só ficam ativos quando o motorista inicia a
corrida**.

Procurei por esse sinal em `openad-api` e no app do tablet e **não encontrei**. A busca foi por
nome e não é exaustiva.

Enquanto o sinal não existir, a cota de exibições por ciclo é dividida entre os tablets
**pareados**, e não entre os que estão de fato em corrida. O efeito é subentrega: a cota dos
tablets parados fica sem uso até o ciclo seguinte. É um refinamento, não um impedimento — a
reserva de crédito continua correta, porque a captura só acontece sobre exibição que realmente
ocorreu.

---

## 6. Scripts de migração a rodar junto com o deploy do openad-api — **Pendente**

Dois scripts de **execução única** que precisam rodar no deploy. Nenhum dos dois é opcional, e
os dois são idempotentes (rodar de novo não faz nada).

### `scripts/marcar-cobranca-aplicada.ts`

A correção da cobrança duplicada do play (G.1), **sozinha, introduz uma cobrança duplicada** no
acervo existente. O processor passou a reivindicar o direito de cobrar por
`findOneAndUpdate({ ..., billingAppliedAt: null })`, e `null` no Mongo casa com campo ausente —
então veiculação gravada antes do campo é reivindicável. No código antigo ela **não** seria
cobrada de novo, porque a condição olhava a transição a partir de `pending`.

O script copia `timestampEnd` para `billingAppliedAt` nas veiculações já faturáveis, e falha se
sobrar qualquer documento sem marca.

```
MONGODB_URI=... pnpm exec ts-node -P app/openad-api/tsconfig.app.json \
  app/openad-api/scripts/marcar-cobranca-aplicada.ts --dry-run
```

**Medido em produção em 2026-10-08** (`89-ensaio-cobranca-aplicada.sh`, só leitura, as mesmas
contagens que o `--dry-run` devolve):

```json
{ "playRecordsNoTotal": 1387, "faturaveisNoTotal": 1387, "faturaveisSemMarca": 1387, "jaMarcados": 0 }
```

Ou seja: **todas** as 1.387 veiculações do acervo estão faturáveis e **nenhuma** tem a marca.
O script não é "por precaução" — sem ele, o primeiro reenvio de um lote antigo depois do deploy
cobra 1.387 veiculações uma segunda vez. O número bate com `opendriver.driver_earnings` (1.389),
que recebe uma linha por repasse de veiculação, o que é a conferência cruzada de que a contagem
é do acervo real e não de um recorte.

### Migration `20261008150000_ad_credit_holds`

Cria `openad.ad_credit_holds` e acrescenta `reference_id`, `amount_micros` e `hold_id` ao
`ad_credit_ledger`. Aditiva, como todas as do openad.

Precisa ser aplicada **antes** do deploy do código: o portão de crédito na elegibilidade
consulta a tabela de reservas, e sem ela toda campanha com anunciante ficaria fora do manifesto
— a frota pararia de veicular anúncio pago.

### Crédito lançado à mão enquanto não houver compra automática

Com o portão de crédito ativo, campanha de anunciante **só vai ao ar se tiver reserva**, e a
reserva só existe se houver saldo no ledger. Hoje o ledger está vazio: nada escrevia nele.

Então, logo após o deploy, é preciso lançar crédito para os anunciantes que devem veicular. O
caminho é `CreditLedgerService.lancarAjuste` (`reason: 'adjustment'`), que registra na auditoria
compartilhada com `openad.credit.adjustment`. A rota de admin para isso entra junto com a
Frente A; até lá o lançamento é por script.

As três campanhas ativas hoje são da conta de demonstração, então o efeito prático de não
lançar é que a demonstração para de veicular — não há anunciante real afetado.

### `scripts/semear-gasto-em-micros.ts`

`campaign_daily_spend.billableCostCents` era o acumulador e passou a ser derivado de
`billableCostMicros`, porque o preço por segundo produz fração de centavo. Linha gravada antes
tem centavos acumulados e micro-reais ausentes.

O serviço tem uma guarda que impede o valor derivado de **descer**, então esquecer o script não
perde dado — mas deixa o gasto do dia congelado até o acumulador em micro-reais alcançar o que
já estava lá, e nesse intervalo o pacing compara um número defasado com o orçamento.

---

## 7. Projeção de repasse do PDF divergindo do padrão do código — **Pendente**

Decisão de produto, não defeito.

O PDF de monetização projeta **50/50** entre motorista e plataforma. O código, quando a campanha
não declara `driverPayout`, repassa o **piso de 30%**. Com isso o teto de R$ 405/mês com tela
100% vendida que o PDF apresenta vira **R$ 243** no padrão atual.

Duas saídas, as duas legítimas: reconferir a projeção do PDF, ou subir o piso para 0,5 no admin
(`platform_config.monetization`). A segunda é uma edição de configuração, sem deploy.

---

## 8. Escopos novos na chave de serviço, para a compra de crédito por Pix — **Pendente**

A Frente A (compra de crédito por Pix) atravessa os dois serviços, e cada direção precisa de um
escopo que **ainda não existe nas chaves cadastradas**. Sem eles o fluxo responde `403` nas duas
pontas, e o anunciante vê "não foi possível gerar a cobrança" sem causa aparente.

| Direção | Rota | Escopo exigido | Onde fica a chave |
| --- | --- | --- | --- |
| openad → hub | `POST /api/v1/internal/ads/credit-charges` | `ads:credit:charge` | `ECOSYSTEM_SERVICE_API_KEY` no `.env` do openad |
| hub → openad | `POST /api/v1/internal/ads/credits/:id/confirm` e `/refund` | `ads:credit:write` | `Internal:AccountSyncKey` em `integration_settings` |

Os dois escopos foram acrescentados ao enum fechado de `createApiKeySchema`, então agora é
possível **criar** chave com eles — mas as chaves que já existem em produção foram emitidas
antes e não os têm. Chave de serviço não é editável por desenho: o valor em texto puro nunca é
persistido, e o escopo faz parte do que foi emitido.

### Como fechar

1. Painel do hub → **Chaves de API** → criar uma chave nova com os escopos:
   `account:read`, `account:purge`, `ads:earning:write`, `ads:payout:read`,
   `ads:credit:charge`, `ads:credit:write`.
   > Uma chave só para os dois sentidos, de propósito. Os três serviços validam contra a
   > **mesma** `public.service_api_keys`, então emitir uma por direção dobraria o número de
   > segredos a rotacionar sem reduzir o alcance de nenhum: quem tem uma já alcança os dois.
2. Colar o valor em **Integrações → Comunicação entre serviços** (`Internal:AccountSyncKey`).
3. Colar o **mesmo** valor em `ECOSYSTEM_SERVICE_API_KEY` no `.env` do openad e redeployar o
   `openad-api`. Esta ponta é variável de ambiente, não configuração de banco — o openad lê
   segredo de `integration_settings`, que é do hub, apenas pelas rotas do hub.
4. Revogar a chave antiga **depois** de confirmar que a nova funciona, não antes: a chave antiga
   ainda serve a exclusão de conta e o repasse ao motorista.

### Risco de não fechar

A compra por Pix não funciona, e a reserva de crédito não tem o que reservar — então campanha de
anunciante não vai ao ar. O contorno existe e é o item 6: lançar crédito à mão em
`POST /api/v1/internal/ads/credits/adjust`. Mas esse contorno **também** exige
`ads:credit:write`, de modo que fechar este item é pré-requisito para qualquer veiculação paga.

---

## 9. `HUB_API_URL` no ambiente do openad-api — **Pendente**

Variável nova, acrescentada em `docker-compose.prod.yml` e em
`infra/server/15-provisionar.sh` com o padrão `https://hubapi.opendriver.com.br`. O contêiner em
produção **não a tem** até o próximo deploy que recarregue o compose.

Sem ela, `PixChargeClient.habilitado()` é `false` e a rota de compra responde `503` com
`PIX_NOT_CONFIGURED` — mensagem que manda o anunciante ao suporte em vez de falhar calada. É
degradação de uma função, de propósito: exigir a variável no boot trocaria uma função indisponível
por um serviço que não sobe.

Conferir depois do deploy:

```
docker exec openad-api printenv HUB_API_URL
```

---

## 10. `VITE_OPENAD_API_URL` no build do painel do hub — **Pendente**

O painel de compra de crédito vive no SPA do hub, em `/conta/credito-de-anuncio`, e fala com a
API do OpenAd direto do navegador — mesmo padrão das telas de Admin → OpenDriver, que usam
`VITE_OPENDRIVER_API_URL`.

`VITE_*` é embutido no bundle em **tempo de build**. Sem a variável, a tela mostra um aviso
explicando o que falta em vez de falhar calada, mas não funciona. O valor de produção é
`https://adsapi.opendriver.com.br`.

Conferir depois do deploy do `hub-frontend` (UUID `krqsjubqpzils0nij3atnekp`): abrir
`https://hub.opendriver.com.br/conta/credito-de-anuncio` logado e ver o saldo, não o aviso.

> CORS não é problema: a API do OpenAd está em `origin: true` (reflete qualquer origem) em
> `app/openad-api/src/main.ts`. Vale registrar que isso é mais permissivo do que precisa ser —
> `origin: true` com `credentials: true` seria perigoso com cookie de sessão, e a API usa só
> `Authorization: Bearer`. Apertar a lista exigiria conhecer todas as origens que já consomem a
> API (portal, tablet, painel do hub), então fica como item separado, não como parte desta
> frente.

---

## 11. APK novo do app do anunciante, com `EXPO_PUBLIC_HUB_WEB_URL` — **Pendente**

O app ganhou o cartão de saldo de crédito e o botão que abre o painel web. As duas coisas estão
no código, e **nenhuma está no APK instalado** — `EXPO_PUBLIC_*` é embutido em tempo de build.

O valor tem padrão de produção no `app.config.ts` (`https://hub.opendriver.com.br`), então um
build sem a variável funciona; ela existe para apontar homologação a outro lugar. Já está em
`eas.json`, em `scripts/apk.ps1` e em `infra/server/38-aab.ps1`.

O que falta é gerar e instalar o APK. O aparelho é o Samsung S21 FE, e a instrução que vale
desde o começo continua valendo: **nada no celular além dos APKs dos quatro aplicativos**.

```
pwsh app/openad-advertiser/scripts/apk.ps1 -Variante preview
```

---

## 4b. Retomada de download — o que foi medido em 2026-10-09

Complemento do item 4, que registrava a pendência enquanto o tablete estava descarregado. O
aparelho foi ligado por cabo em 09/10 e as duas dúvidas abertas foram resolvidas — uma delas
revelando um defeito maior do que o suspeitado.

### CORS do storage: **não era o problema** — Concluído

Medido com `curl` contra `storage.opendriver.com.br`, com `Origin` e `Range`:

```
HTTP/1.1 206 Partial Content
content-range: bytes 0-99/855019
access-control-expose-headers: Date, Etag, Server, Connection, Accept-Ranges, Content-Range,
  Content-Encoding, Content-Length, Content-Type, ... , *
```

E o preflight responde `204` com `access-control-allow-headers: range`.

Ou seja, `Content-Range` **é** legível pelo WebView. A hipótese do plano (de que faltava
`Access-Control-Expose-Headers` e por isso a retomada recomeçava do zero) estava errada, e
configurar o CORS do MinIO — item 2 do "o que fazer" da Frente F — **não é necessário**.

### URL pré-assinada vencida: `403` — Concluído

Assinatura inválida/vencida responde `403` com `<Code>InvalidAccessKeyId</Code>`. Tratar `403`
como "URL vencida, busque o manifesto de novo" é, portanto, a regra correta, e foi implementada.

### O defeito de verdade: os bytes não eram persistidos — Concluído

Medir o CORS fez sobrar uma pergunta: se o `Content-Range` sempre foi legível, por que ninguém
viu a retomada funcionar? Lendo `resumable-download.service.ts` com essa pergunta na mão:

**Só o offset era persistido. Os bytes ficavam num vetor local que nascia vazio a cada
chamada.** Na retomada, `getOffset()` devolvia (digamos) 5 MB, o laço pedia `bytes=5242880-`,
recebia a cauda, e devolvia **apenas a cauda** — sem os 5 MB do início. O `DownloadManagerService`
conferia o SHA-256, não fechava, apagava o offset e baixava tudo de novo.

Resultado: cada retomada custava um download parcial perdido **mais** um download inteiro, e
nunca retomava. Nada falhava de forma visível — e o arquivo não tinha teste nenhum.

Consertado persistindo os pedaços no IndexedDB (store `downloadChunks`, versão 2 do banco) e
tornando o offset **derivado** da soma deles, de modo que não existe o estado em que o offset
aponta para além dos bytes que temos. 12 testes novos, incluindo o caso "retomada entrega o
arquivo inteiro, não só a cauda".

### Verificado no tablete — Concluído em parte

O tablete (Vaio TL10, Android 13, WebView 155) recebeu o APK com o conserto por cabo. Para
forçar um download novo, a pasta de mídia foi apagada e o app reiniciado:

```
{"event":"download.resposta","status":200,"pediuRange":false,"contentRange":null,"offset":0}
  (quatro vezes — um por criativo)
{"event":"playback.current","mediaId":"a54725f6-…","kind":"image","src":"https://localhost/_capacitor_file_/…"}
```

Ou seja: os quatro criativos baixaram do storage, passaram pela conferência de SHA-256, foram
gravados e voltaram à tela. O caminho de download está verificado **no aparelho**, com o código
novo.

O log estruturado (`download.retomando`, `download.resposta`, `download.concluido`) foi
acrescentado nesta leva justamente porque a falha anterior era silenciosa. `adb logcat | findstr
download.` agora responde "retomou de onde?" sem depurador.

### O que ainda não foi provado no aparelho — **Pendente**

**A ramificação de retomada em si.** Os quatro criativos em produção hoje são imagens de 7 KB a
429 KB, que terminam numa única resposta `200` — não há janela para cortar a rede no meio. O
ensaio que falta exige um criativo grande o bastante para o download durar alguns segundos.

O que já sustenta a correção, enquanto esse criativo não existir:

- 12 testes de unidade novos em `resumable-download.service.spec.ts`, incluindo "retomada
  entrega o arquivo inteiro, não só a cauda", "erro de rede deixa os bytes guardados para a
  próxima tentativa" e os três casos de `403`.
- O comportamento do storage medido com `curl`: `206`, `Content-Range` presente e exposto no
  CORS, preflight aceitando `Range`, e `403` em assinatura vencida.

Para fazer o ensaio quando houver vídeo: subir um criativo de vídeo numa campanha, apagar
`files/media` no aparelho, reiniciar o app, e durante o download rodar
`adb shell svc wifi disable` seguido de `svc wifi enable`. O esperado no log é
`download.retomando` com `offset` maior que zero e, em seguida, `download.resposta` com
`status: 206` e `pediuRange: true`.

### Inconsistência anotada de passagem

`app/openad-ad-client/capacitor.config.ts` declara `appId: 'com.openad.adclient'`, mas o projeto
Android gerado usa `com.openad` — que é o que está instalado e o que `62-apk-player.ps1` espera.
Hoje não dá problema porque o `android/` já existe e não é regenerado. Um `cap add android` do
zero produziria um **segundo** aplicativo, e a frota pareada continuaria no antigo. Alinhar exige
decidir qual dos dois vale, e trocar o `applicationId` obriga a desinstalar e reinstalar em cada
tablete — por isso fica registrado em vez de corrigido no meio desta frente.

---

## 12. Aplicar as quatro migrations da v2 em produção — **Pendente (aguarda autorização)**

Entra aqui, e não no plano, porque é a única etapa da leva que **não é trabalho de código**: é
uma escrita irreversível no banco que três aplicativos publicados leem, e a decisão de quando
fazer não é minha.

### O que está pendente em produção

Conferido em 2026-10-08 no container `l5bcr9slmgtmeefkqwg5amia`:

| schema | está em | falta aplicar |
| --- | --- | --- |
| `openad` | `20261003000000_init_openad` | `20261008150000_ad_credit_holds`, `20261008170000_credito_por_pix` |
| `public` (hub) | `20261002210000_push_tokens` | `20261009120000_estoque_por_unidade_e_horario`, `20261009140000_sem_avatar_de_terceiro` |
| `opendriver` | `20261008120000_seed_vehicle_model_categories` | — em dia |

### Ordem obrigatória, e o que acontece se for invertida

`ad_credit_holds` tem de estar aplicada **antes** do deploy do openad-api. A reserva de crédito
da frente H.4 consulta essa tabela ao montar o manifesto; sem ela, a consulta falha e **toda
campanha com anunciante sai do manifesto** — a frota continuaria exibindo, mas só o que não tem
anunciante. O inverso (tabela antes do código) é inofensivo: tabela vazia que ninguém lê.

### O que já foi feito para reduzir o risco

1. **Backup completo e verificado**, em `/root/backups/v2-20261008-203513Z`:
   `globals.sql`, `hub.dump` (408 objetos no índice, `pg_restore --list` passou),
   `hub-plain.sql.gz`, `mongo-openad.archive.gz`, `minio-data.tar.gz` (52 MB),
   `integration_settings.sql` e a linha de base dos três schemas. `/root/backups/ULTIMO`
   aponta para ele, que é de onde `10-migrations-producao.sh` lê o pré-requisito.

2. **Sandbox recriado desse backup** e conferido fiel (`07-sandbox.sh`).

3. **Ensaio com o comando de verdade.** O primeiro ensaio aplicou o SQL direto por `psql`, o
   que prova que o SQL roda mas **não** prova que o Prisma registra o histórico — e é
   `prisma migrate deploy` que vai rodar em produção. O sandbox foi recriado e o ensaio
   refeito por `08-migrations-ensaio.sh`, que usa exatamente esse comando. Resultado:

   - `openad` chegou a `20261008170000_credito_por_pix`, `public` a
     `20261009140000_sem_avatar_de_terceiro`;
   - o diff de `pg_dump --schema-only --schema=public` é **só aditivo**: `order_items` ganhou
     `redeemed_store_id`; `partner_stores` ganhou `opening_hours`, `timezone` e `active`;
     `product_store_stock` foi criada com a chave primária, o único de `(product_id, store_id)`
     e o índice de `store_id`; **nada removido** ("objetos REMOVIDOS: nenhum");
   - `opendriver` e `openad` **não** tocaram `public`, conforme o critério do script;
   - as FKs de `product_store_stock` apontam para `products(id)` e `partner_stores(id)`, as
     duas com `ON DELETE CASCADE`;
   - o enum `AdStore` passou a `apple, google, pix`;
   - `ad_credit_purchases.product_sku` ficou anulável e `credit_micros` existe;
   - a migration de avatar limpou 40 linhas de `users` e 4 de `partners`, e a contagem de
     endereços de terceiro (dicebear, ui-avatars, gravatar) caiu a zero nas duas tabelas.

4. **Dois erros meus, corrigidos no caminho.** Ficam registrados porque os dois eram do tipo
   que passa como "ok":

   - a primeira versão da conferência olhava `public.stores`, tabela que **não existe** — a
     do hub é `partner_stores`. O script respondia "a coluna não está lá" por estar olhando
     o lugar errado, o que num ensaio é pior que não conferir;
   - `07-sandbox.sh` comparava o sandbox com produção **ao vivo** e exigia igualdade. Como
     `driver_earnings` recebe linha a cada repasse de receita de anúncio, a conferência
     acusava divergência em toda execução (prod 1389, sandbox 1371) e reprovava um sandbox
     que estava correto. Passou a declarar, por tabela, se ela deve estar `exato` ou se
     `cresce` — e, nas que crescem, aceita sandbox menor e informa quantas escritas entraram
     depois do dump, mas continua reprovando sandbox **maior**, que não teria explicação.

### Como fechar

Com autorização, nesta ordem:

```bash
# 1. migrations (hub -> opendriver -> bootstrap -> openad), com diff de public a cada passo
bash /root/openad-infra/10-migrations-producao.sh

# 2. scripts de dados do openad, os dois com --dry-run antes
#    marcar-cobranca-aplicada.ts e OBRIGATÓRIO: sem ele a correção G.1 cobra em dobro o acervo
# 3. deploy: openad-api, hub-backend, hub-frontend
bash /root/openad-infra/24-coolify-deploy.sh
```

As pastas `prisma/` dos três repositórios já estão sincronizadas e conferidas por SHA-256 em
`/root/openad-infra/prisma/` (`86-sincronizar-prisma.ps1`). Sem essa sincronização o
`migrate deploy` aplicaria menos do que se espera e terminaria dizendo "ok" — a falha mais
silenciosa possível neste caminho.

### Risco de não fechar

O código da v2 está commitado e testado, mas **nada dele funciona em produção**: compra de
crédito por Pix, reserva de crédito, estoque por unidade, horário de funcionamento e a limpeza
dos avatares de terceiro todos dependem destas quatro migrations.

---

## 13. Tablete da Vaio com bloqueio de tela — **Pendente**

O tablete `4AH47852E` (Vaio TL10, Android 13) está com cabo ligado e `adb` autorizado, e os três
APKs foram instalados com sucesso nesta leva:

| pacote | app | resultado |
| --- | --- | --- |
| `br.com.opendriverhub.app.preview` | hub-mobile | `Success` (132,9 MB) |
| `br.com.opendriver.app.preview` | opendriver mobile | `Success` (154,9 MB) |
| `br.com.opendriver.ads.preview` | openad-advertiser | `Success` (106,2 MB) |
| `com.openad` | player | já instalado, em exibição |

A **verificação visual** das telas novas (gestão de produto no app do parceiro, avatar de
iniciais, cartão de crédito de veiculação) está bloqueada: o aparelho pede PIN, e a tela de
entrada do PIN tem `FLAG_SECURE` — `screencap` devolve arquivo inválido enquanto ela está à
frente, então não há como capturar nem o aplicativo atrás dela.

O que foi possível confirmar sem desbloquear, por `88-conferir-apps-tablet.ps1`:

- a instalação dos três pacotes;
- **os três sobem e continuam vivos**: processo de pé depois de 18 s, nenhuma exceção fatal,
  nenhum erro vindo do JavaScript, nenhuma falha de rede na partida. Isso prova que o pacote
  JavaScript carrega e que a navegação inicial não quebra; **não** prova que a tela está
  desenhada certa, que continua exigindo o aparelho desbloqueado;
- `br.com.opendriver.ads.preview` (app do anunciante) foi reconstruído nesta leva e carrega
  `https://hub.opendriver.com.br/conta/credito-de-anuncio` no pacote — é o endereço que o
  botão de comprar crédito abre. Conferido extraindo `index.android.bundle` do APK, não só
  olhando o `eas.json`;
- rede funcionando (ping a `hubapi.opendriver.com.br` com 0% de perda, 38 ms de média) mesmo
  com o aparelho em modo avião, porque o Wi-Fi está ligado por cima;
- o player estava em primeiro plano **exibindo um criativo** quando o aparelho foi encontrado,
  o que é a evidência de que a frente F segue funcionando depois da troca de código;
- o player estava em `mLockTaskModeState=PINNED` (tela fixada), o que impedia qualquer outro
  aplicativo de vir à frente. Desafixado com `am task lock stop` — é reversível e não altera
  configuração do aparelho.

Para fechar: desbloquear o tablete (ou informar o PIN). Com ele desbloqueado a captura volta a
funcionar e as três telas podem ser conferidas por imagem.
