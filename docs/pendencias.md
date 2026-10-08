# Pendências do ecossistema OpenDriver

Documento **incremental**: itens novos entram no fim, e o status ao lado do título muda de
`Pendente` para `Concluído` quando o item fecha. Nada é apagado — uma pendência resolvida vale
como registro do que foi feito e de quando.

O que entra aqui: o que **depende de uma ação externa** ou de uma decisão que não é minha —
credencial de terceiro, permissão em console de loja, aparelho físico, decisão de custo. O que é
só trabalho de código vive no `plano-v2-ecossistema.md`, não aqui.

Última revisão: 2026-10-08.

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

## 6. Projeção de repasse do PDF divergindo do padrão do código — **Pendente**

Decisão de produto, não defeito.

O PDF de monetização projeta **50/50** entre motorista e plataforma. O código, quando a campanha
não declara `driverPayout`, repassa o **piso de 30%**. Com isso o teto de R$ 405/mês com tela
100% vendida que o PDF apresenta vira **R$ 243** no padrão atual.

Duas saídas, as duas legítimas: reconferir a projeção do PDF, ou subir o piso para 0,5 no admin
(`platform_config.monetization`). A segunda é uma edição de configuração, sem deploy.
