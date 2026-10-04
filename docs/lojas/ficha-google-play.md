# Ficha do Google Play — respostas prontas para os três apps

Última atualização: 04/10/2026.

Este documento é fonte de copiar e colar. Cada campo abaixo corresponde a um campo real do
Play Console, com a resposta já na forma em que ela deve ser colada.

Estado dos envios: os três AAB estão **na faixa de teste interno**, versionCode 1, status
`completed`. Nada aqui depende de subir arquivo novo.

| App | ID do pacote | AAB enviado |
| --- | --- | --- |
| OpenDriver | `br.com.opendriver.app` | 93,7 MB |
| OpenDriver HUB | `br.com.opendriverhub.app` | 86,9 MB |
| OpenDriver Anúncios | `br.com.opendriver.ads` | 72,1 MB |

---

## 1. Acesso ao app — "Detalhes do login"

Caminho: **Política e programas → Conteúdo do app → Acesso ao app**.

Responda **"Todas as funcionalidades estão disponíveis com restrição de acesso"** e cadastre
as instruções abaixo. As contas existem em produção e foram conferidas de fora
(`infra/server/46-conferir-contas-demo.mjs`).

Senha das três contas: `PlayReview2026`

### OpenDriver (`br.com.opendriver.app`) — duas instruções

**Instrução 1 — Passageiro**

- Nome: `Passageiro`
- Nome de usuário: `play.passageiro@opendriver.com.br`
- Senha: `PlayReview2026`
- Qualquer outra instrução:

```
Abra o app, toque em "Entrar" e use o e-mail e a senha acima. Não há confirmação por
e-mail nem por SMS. A conta já tem perfil de passageiro ativo: na tela inicial, toque em
"Para onde?", escolha um destino no mapa e o app mostra o preço estimado antes de
confirmar. O app pede permissão de localização para definir o ponto de embarque; conceda
para ver o fluxo completo.
```

**Instrução 2 — Motorista**

- Nome: `Motorista`
- Nome de usuário: `play.motorista@opendriver.com.br`
- Senha: `PlayReview2026`
- Qualquer outra instrução:

```
Esta conta está com o cadastro de motorista APROVADO e ONLINE, e com veículo aprovado
(Chevrolet Onix 2022, placa DEM1A23). Ao entrar, o app abre direto na área de motorista:
estado online, extrato de ganhos, documentos, veículos e chave Pix. Não é preciso enviar
documento nem aguardar análise. Para ver as telas de passageiro, use a outra conta.
O app pede localização em segundo plano: ela é enviada apenas enquanto o motorista está
online ou em corrida, e para quando ele fica offline.
```

### OpenDriver HUB (`br.com.opendriverhub.app`) — uma instrução

- Nome: `Cliente`
- Nome de usuário: `play.passageiro@opendriver.com.br`
- Senha: `PlayReview2026`
- Qualquer outra instrução:

```
A conta é a mesma do app OpenDriver: os dois serviços compartilham a base de usuários do
ecossistema. Não há confirmação por e-mail nem por SMS. Ao entrar, o app abre o catálogo
das lojas parceiras; é possível navegar por categoria, abrir um produto, adicionar ao
carrinho e chegar ao checkout. O extrato de cashback fica em "Conta → Cashback".
```

### OpenDriver Anúncios (`br.com.opendriver.ads`) — uma instrução

- Nome: `Anunciante`
- Nome de usuário: `play.anunciante@opendriver.com.br`
- Senha: `PlayReview2026`
- Qualquer outra instrução:

```
Conta de anunciante já ativa, com R$ 500,00 de crédito de veiculação lançado. Não é
preciso comprar crédito para avaliar o app. Ao entrar, o app abre a lista de campanhas;
em "Nova campanha" é possível percorrer todo o fluxo de criação, envio de criativo e
envio para moderação. A conta é a mesma do OpenDriver e do OpenDriver HUB.
```

> Ressalva honesta: a caixa de e-mail do domínio `opendriver.com.br` **não entrega nem
> recebe** mensagens hoje (registro MX nulo). Como nenhum dos três serviços exige
> confirmação de e-mail para entrar, isso não bloqueia o revisor que usa as contas acima.
> Bloquearia um revisor que decidisse criar a própria conta e esperar o e-mail de
> verificação. Resolver isso é o item 9 deste documento.

---

## 2. Exclusão de conta e política de privacidade

Caminho: **Política e programas → Conteúdo do app → Exclusão de dados** e
**Painel da ficha da loja → Política de privacidade**.

Responda que o app oferece exclusão de conta **dentro do app e também por um link na web**.

| App | Link de exclusão de conta | Política de privacidade |
| --- | --- | --- |
| OpenDriver | `https://api-app.opendriver.com.br/legal/exclusao-de-conta` | `https://api-app.opendriver.com.br/legal/privacidade` |
| OpenDriver HUB | `https://hubapi.opendriver.com.br/legal/exclusao-de-conta` | `https://hubapi.opendriver.com.br/legal/privacidade` |
| OpenDriver Anúncios | `https://adsapi.opendriver.com.br/legal/exclusao-de-conta` | `https://adsapi.opendriver.com.br/legal/privacidade` |

Termos de uso (campo opcional, mas vale preencher): mesmos domínios, caminho `/legal/termos`.

As nove páginas foram conferidas de fora com HTTP 200, razão social, CNPJ e e-mail de
contato visíveis em texto puro (`infra/server/43-conferir-legal-externo.ps1`).

Caminho dentro do app, para descrever no formulário:

- OpenDriver: `Conta → Excluir minha conta`
- OpenDriver HUB: `Conta → Excluir minha conta`
- OpenDriver Anúncios: a exclusão é feita pelo app do ecossistema; o app do anunciante
  encaminha para lá.

---

## 3. Recursos financeiros

Caminho: **Política e programas → Conteúdo do app → Recursos financeiros**.

A lista oficial de opções está em
[Enviar informações para a declaração de recursos financeiros](https://support.google.com/googleplay/android-developer/answer/13849271?hl=pt-BR).
*Conteúdo rephrased para conformidade com restrições de licenciamento.*

| App | Resposta |
| --- | --- |
| OpenDriver | **Contratos de compra → Prêmios, pontos, milhas aéreas e outros incentivos** |
| OpenDriver HUB | **Contratos de compra → Prêmios, pontos, milhas aéreas e outros incentivos** |
| OpenDriver Anúncios | **Meu app não oferece recursos financeiros** |

Por que cada uma:

- **HUB**: o cashback é um programa de incentivo com saldo acumulado e extrato. É o encaixe
  direto da opção "Prêmios, pontos, milhas aéreas e outros incentivos".
- **OpenDriver**: o mesmo saldo de cashback é gasto como desconto na corrida
  (`passenger_profiles.use_hub_cashback`), então o incentivo está presente também aqui.
- **Anúncios**: o crédito de veiculação é comprado pela cobrança da própria loja e só pode
  ser gasto em veiculação — sem resgate em dinheiro, sem transferência e sem rendimento.
  Isso é consumo pré-pago de um serviço do app, não recurso financeiro.

**Esta é a resposta com maior grau de julgamento de todo o documento, e quem assina a
declaração é você.** Dois pontos que podem levar a uma leitura diferente da minha:

1. O OpenDriver paga o motorista por Pix (`driver_profiles.pix_key`, saque em
   `/driver/payouts`). Eu **não** declarei "Transferência de dinheiro e serviços de
   transferência eletrônica" porque isso é pagamento ao prestador pelo serviço que ele
   executou, como faz qualquer plataforma de corrida — não é um serviço de transferência
   oferecido ao usuário. Se a revisão discordar, a correção é acrescentar essa opção, o que
   não derruba o app: é uma declaração, não uma permissão.
2. O saldo de cashback do HUB é **sacável** (`public.users.cashback_balance`). Isso reforça
   a opção de incentivo já declarada, e não cria um produto financeiro novo.

---

## 4. Categoria, tags e detalhes da loja

Caminho: **Crescer → Presença na Play Store → Configuração da ficha da loja**.

| App | Categoria do app | Alternativa defensável | Tags sugeridas |
| --- | --- | --- | --- |
| OpenDriver | **Viagens e local** | Mapas e navegação | Transporte por aplicativo, Carona, Táxi |
| OpenDriver HUB | **Compras** | Estilo de vida | Cupons e descontos, Recompensas, Marketplace |
| OpenDriver Anúncios | **Negócios** | Produtividade | Marketing, Publicidade, Gestão de negócios |

A categoria é editável a qualquer momento e não exige nova revisão do binário, então não vale
travar aqui. "Viagens e local" é onde o usuário brasileiro procura app de corrida; "Mapas e
navegação" é onde parte dos concorrentes está. Qualquer das duas passa.

---

## 5. Dados de contato

Caminho: **Configuração da ficha da loja → Dados de contato do desenvolvedor**.

- E-mail: `murilogillbert@gmail.com`
- Site: `https://opendriver.com.br` (responde HTTP 200; é a página institucional do HUB)
- Telefone: **deixe em branco**. O campo é público na ficha e não há linha de atendimento
  dedicada; publicar um celular pessoal expõe o número a quem navega na loja.

Endereço do desenvolvedor (obrigatório na conta, não na ficha de cada app):

```
Heavenbound Systems LTDA
CNPJ 51.574.461/0001-09
Rua 9, Lote 05, Rua das Pitangueiras, Lote 6, Loja 11 e 12
Norte (Águas Claras), Brasília/DF, CEP 71.908-540
```

---

## 6. Nome, breve descrição e descrição completa

Limites do Play: nome **30**, breve descrição **80**, descrição completa **4000**.
As contagens abaixo foram medidas com `infra/server/49-conferir-textos-loja.ps1`.

### 6.1 OpenDriver

**Nome do app**

```
OpenDriver
```

**Breve descrição**

```
Peça corrida, dirija e receba. Passageiro e motorista no mesmo aplicativo.
```

**Descrição completa**

```
O OpenDriver é o app de corridas do ecossistema Open Driver. Passageiro e motorista usam o mesmo aplicativo: você pede uma corrida hoje e, se quiser dirigir amanhã, ativa o perfil de motorista sem criar outra conta.

PARA QUEM PEDE CORRIDA

• Preço antes de confirmar: você vê o valor estimado, a categoria do carro e o tempo de chegada antes de pedir.
• Pagamento do seu jeito: cartão de crédito ou Pix.
• Cashback que desconta: o saldo que você acumula nas lojas parceiras do OpenDriver HUB entra como desconto na corrida.
• Corrida agendada: marque origem, destino e horário com antecedência.
• Motorista favorito: salve quem te atendeu bem e dê preferência a ele nas corridas agendadas.
• Locais salvos: casa, trabalho e os endereços que você mais usa, a um toque.
• Peça para outra pessoa: chame a corrida para um familiar ou convidado, com o endereço e o contato dele.
• Acessibilidade: peça veículo adaptado para cadeira de rodas.
• Corrida entre mulheres: passageira e motorista mulher podem ativar, de forma opcional, o atendimento apenas entre mulheres.
• Acompanhe no mapa o carro a caminho, a rota e o tempo restante, com chat rápido dentro da corrida.

SEGURANÇA

• Contatos de confiança: cadastre quem deve ser avisado se algo acontecer.
• Compartilhar a viagem: envie um link e quem receber acompanha o trajeto até o fim da corrida.
• Botão de emergência dentro da corrida.
• Gravação de áudio opcional: só se você ativar. O áudio é criptografado, guardado por 30 dias e só pode ser ouvido pela equipe de segurança quando houver uma ocorrência registrada na viagem.
• Denúncia e reclamação com anexo de foto, direto do app.
• Avaliação nas duas pontas ao fim de cada viagem.

PARA QUEM DIRIGE

• Cadastro pelo celular: envie a CNH, uma selfie e o documento do veículo (CRLV) e acompanhe a análise.
• Fique online quando quiser e veja valor, distância e ponto de embarque antes de aceitar a corrida.
• Extrato de ganhos corrida por corrida, incluindo o repasse da publicidade exibida no veículo.
• Saque por Pix, com a chave que você cadastrar.
• Mais de um veículo cadastrado, e você escolhe com qual vai rodar.

SEM ANÚNCIOS NO APP

O OpenDriver não exibe publicidade dentro do aplicativo e não usa identificador de publicidade.

PRIVACIDADE E LOCALIZAÇÃO

A localização do motorista é enviada enquanto ele está online ou em corrida, inclusive com o app em segundo plano: é isso que permite encontrar corridas próximas e mostrar ao passageiro o carro a caminho. Ao ficar offline, o envio para. A localização do passageiro é usada para definir o embarque e acompanhar a viagem.

Política de privacidade: https://api-app.opendriver.com.br/legal/privacidade
Termos de uso: https://api-app.opendriver.com.br/legal/termos
Excluir sua conta: https://api-app.opendriver.com.br/legal/exclusao-de-conta

Heavenbound Systems LTDA (Open Driver) — CNPJ 51.574.461/0001-09
Suporte: murilogillbert@gmail.com
```

### 6.2 OpenDriver HUB

**Nome do app**

```
OpenDriver HUB
```

**Breve descrição**

```
Compre nas lojas parceiras, ganhe cashback e use o saldo nas suas corridas.
```

**Descrição completa**

```
O OpenDriver HUB é o marketplace com cashback do ecossistema Open Driver. Você compra em lojas parceiras, recebe parte do valor de volta e usa esse saldo onde ele vale mais: nas suas corridas no app OpenDriver.

COMO FUNCIONA

• Escolha: navegue pelo catálogo por categoria e veja as lojas parceiras mais perto de você.
• Compre: monte o carrinho e pague no app, com cartão ou Pix.
• Resgate: o pedido gera um voucher com código, que a loja lê no balcão.
• Ganhe: o cashback é creditado na sua conta e aparece no extrato, lançamento por lançamento.
• Use: o saldo vira desconto nas corridas do OpenDriver, ou fica acumulado para a próxima compra.

NO APP VOCÊ TEM

• Catálogo de produtos e serviços das lojas parceiras, com foto, preço e avaliação.
• Carrinho e checkout com pagamento dentro do próprio app.
• Histórico de pedidos, com o status de cada um e o voucher sempre à mão.
• Extrato de cashback: o que entrou, o que foi usado e o saldo atual.
• Notificações sobre os seus pedidos e vouchers.
• Código de indicação: informe no checkout o código de quem te convidou.
• Conta única: a mesma conta vale no OpenDriver e no OpenDriver Anúncios.

PARA LOJAS PARCEIRAS

Se você tem um comércio, o app também registra no balcão a venda do voucher e acompanha o repasse.

SEM RASTREAMENTO PARA PUBLICIDADE

O OpenDriver HUB não exibe anúncios, não usa identificador de publicidade e não compartilha dados com rede de publicidade.

A localização é usada apenas quando você autoriza, para ordenar as lojas por proximidade, e nunca em segundo plano. A câmera é usada somente para ler o QR do voucher no momento do resgate, e nenhuma imagem é guardada.

Política de privacidade: https://hubapi.opendriver.com.br/legal/privacidade
Termos de uso: https://hubapi.opendriver.com.br/legal/termos
Excluir sua conta: https://hubapi.opendriver.com.br/legal/exclusao-de-conta

Heavenbound Systems LTDA (Open Driver) — CNPJ 51.574.461/0001-09
Suporte: murilogillbert@gmail.com
```

### 6.3 OpenDriver Anúncios

**Nome do app**

```
OpenDriver Anúncios
```

Alternativa, se você preferir manter a sigla da marca: `OpenDriver AD`. Prefiro
"Anúncios": na busca da loja, quem procura por "anúncio" encontra; "AD" não diz nada a
quem não conhece a marca.

**Breve descrição**

```
Crie campanhas e anuncie nas telas dos carros. Relatório por campanha.
```

**Descrição completa**

```
O OpenDriver Anúncios é o app do anunciante da rede OpenDriver Ads: as telas instaladas nos veículos que rodam com o OpenDriver. Do celular, em poucos minutos, você cria uma campanha, envia o criativo, escolhe região e horário e acompanha quantas vezes o anúncio foi exibido.

O QUE VOCÊ FAZ NO APP

• Crie a campanha: nome, período, orçamento e valor por exibição.
• Envie o criativo: imagem ou vídeo, direto da galeria do celular.
• Escolha onde e quando: região de circulação e faixa de horário.
• Envie para moderação: todo criativo passa por análise antes de ir ao ar.
• Acompanhe o relatório: exibições confirmadas e veículos distintos alcançados, por campanha.
• Pause, retome ou encerre a campanha quando quiser.

CRÉDITO DE VEICULAÇÃO

Você compra crédito dentro do app e gasta conforme a campanha roda. Não há mensalidade e não há contrato mínimo.

O crédito serve apenas para veicular anúncio: não é resgatável em dinheiro, não é transferível e não rende.

PRIVACIDADE DE QUEM VÊ A TELA

A escolha do anúncio usa a região, o horário e características do próprio veículo. Nunca quem está dentro dele.

A tela não tem câmera nem microfone, não lê identificador de celular e não se conecta ao aparelho do passageiro. Não há perfil de audiência e não há atribuição de anúncio a pessoa: o relatório que você recebe é agregado, nunca uma lista de pessoas.

CONTA

A conta do OpenDriver Anúncios é a mesma do OpenDriver e do OpenDriver HUB. Se você já usa qualquer um dos dois, entre com o mesmo e-mail e senha e adira como anunciante na primeira tela.

Política de privacidade: https://adsapi.opendriver.com.br/legal/privacidade
Termos de uso: https://adsapi.opendriver.com.br/legal/termos
Excluir sua conta: https://adsapi.opendriver.com.br/legal/exclusao-de-conta

Heavenbound Systems LTDA (Open Driver) — CNPJ 51.574.461/0001-09
Suporte: murilogillbert@gmail.com
```

---

## 7. Ativos gráficos

Gerados por `infra/server/48-arte-lojas.ps1`, em `docs/lojas/google-play/`:

| App | Ícone 512×512 | Recurso gráfico 1024×500 |
| --- | --- | --- |
| OpenDriver | `opendriver-icone-512.png` | `opendriver-destaque-1024x500.png` |
| OpenDriver HUB | `opendriverhub-icone-512.png` | `opendriverhub-destaque-1024x500.png` |
| OpenDriver Anúncios | `opendriverads-icone-512.png` | `opendriverads-destaque-1024x500.png` |

Todos PNG 32 bits, nas dimensões exatas que o Play exige.

### Sobre os três ícones serem iguais

Eram. `opendriver/mobile/assets/icon.png` e `hub-mobile/assets/icon.png` são **byte a byte
idênticos** (SHA-256 `9019C812…`), e o ícone do app de anunciante era um marcador genérico
de 7 KB que eu mesmo havia colocado como provisório.

Três apps da mesma empresa com o mesmo ícone **não é motivo de reprovação** no Google, mas
confunde o usuário na gaveta de aplicativos e desperdiça a marca. O que eu fiz: mantive a
marca intacta nos três — o "D" em alfinete de mapa com o volante — e mudei **só a cor de
fundo**:

- OpenDriver: navy `#0C1B2A`, o original
- OpenDriver HUB: verde profundo `#0A2A22`, pela associação com cashback
- OpenDriver Anúncios: violeta profundo `#1E1033`

Se você preferir os três idênticos, use `opendriver-icone-512.png` nos três. Se preferir
marcas realmente distintas, isso é trabalho de design e não de script: o que está aqui é
uma base que não bloqueia a publicação.

---

## 8. Classificação, público e anúncios

| Campo | OpenDriver | HUB | Anúncios |
| --- | --- | --- | --- |
| Anúncios | Não contém anúncios | Não contém anúncios | Não contém anúncios |
| Público-alvo | 18 anos ou mais | 18 anos ou mais | 18 anos ou mais |
| Voltado a crianças | Não | Não | Não |
| App de notícias | Não | Não | Não |
| COVID-19 / saúde | Não | Não | Não |
| Governo | Não | Não | Não |

"Não contém anúncios" vale até para o app de Anúncios: ele é a ferramenta de quem compra
mídia, e não exibe publicidade de terceiro para o seu próprio usuário. A publicidade da rede
roda nas telas instaladas nos veículos, que não são um app do Google Play.

### Segurança dos dados — resumo por app

O formulário é longo e muda de layout com frequência; o que importa é que a resposta seja
consistente com a política publicada. As políticas no ar declaram exatamente isto:

**OpenDriver** — coleta e envia: nome, e-mail, telefone, CPF; localização precisa (do
motorista também em segundo plano); documentos (CNH, selfie, CRLV); informações de
pagamento (token do cartão, bandeira, 4 últimos dígitos); áudio **opcional** das viagens;
contatos de confiança; token de notificação. Tudo criptografado em trânsito. Exclusão de
conta disponível. Nenhum dado é vendido; nenhum uso para publicidade.

**OpenDriver HUB** — nome, e-mail, telefone, CPF, foto de perfil opcional; histórico de
compras; cashback; informações de pagamento (token); localização **aproximada ou precisa só
com autorização, nunca em segundo plano**; câmera **apenas** para ler o QR do voucher, sem
armazenar imagem; mensagens de atendimento; token de notificação. Sem identificador de
publicidade.

**OpenDriver Anúncios** — nome, e-mail, telefone, CPF/CNPJ do anunciante; razão social;
dados da campanha; arquivos de criativo enviados pelo usuário; recibo da compra na loja
(sem dado de cartão); registro de ações para auditoria. Não coleta localização do aparelho
e não usa IDFA/GAID.

---

## 9. O que ainda falta — e o que está bloqueando

1. **Capturas de tela** (obrigatório: mínimo 2 por app, 16:9 ou 9:16, lado maior entre 320
   e 3840 px). Pendente. Precisa de emulador: o SDK em `D:\dev\android-sdk` não tem nenhuma
   imagem de sistema instalada, e baixar uma passa de 1,5 GB. Alternativa mais rápida:
   capturar de um aparelho físico com o APK de preview que já está gerado em cada repo
   (`outputs/apk/release/app-release.apk`), usando as contas da seção 1.
2. **E-mail do ecossistema** (não é campo de formulário, é risco de revisão). O domínio
   `opendriver.com.br` tem MX nulo, SPF `-all` e DMARC `p=reject`: não entrega e não recebe.
   Dois caminhos: (a) apontar o remetente do SMTP para `murilogillbert@gmail.com` e aceitar
   que os links de verificação saem de um Gmail; ou (b) configurar MX, SPF e DKIM no
   domínio. Enquanto nenhum dos dois for feito, qualquer fluxo que dependa de e-mail
   (verificação, recuperação de senha) não funciona para o usuário final — e isso é mais
   grave para o produto do que para a revisão.
3. **Rotações de segurança**, combinadas para depois da publicação: senha root da VPS, os
   dois tokens Expo colados no chat e `PasswordAuthentication no` no SSH.

---

## 10. O que já está preenchido pela API, e o que falta na interface

Preenchido em 04/10/2026 por `infra/server/53-publicar-ficha-play.mjs`, conferido depois por
`52-ler-ficha-play.mjs`:

| Campo | OpenDriver | HUB | Anúncios |
| --- | --- | --- | --- |
| AAB versionCode 2 | produção (enviado por você) | faixa interna | faixa interna |
| Nome do app | ok | ok | ok (`OpenDriver Anúncios`) |
| Breve descrição | ok | ok | ok |
| Descrição completa | ok | ok | ok |
| Ícone 512×512 | ok | ok | ok |
| Recurso gráfico 1024×500 | ok | ok | ok |
| E-mail e site de contato | ok | ok | ok |
| Capturas de tela | 2 enviadas | **falta** | **falta** |

A API do Play **não expõe** a seção "Conteúdo do app" — conferido no documento de descoberta
da v3, cujos únicos recursos de `edits` são `apks`, `bundles`, `countryavailability`,
`deobfuscationfiles`, `details`, `expansionfiles`, `images`, `listings`, `testers` e `tracks`.
Tudo abaixo é só pela interface, com as respostas das seções 1 a 8 deste documento:

- Acesso ao app (seção 1)
- Política de privacidade e exclusão de dados (seção 2)
- Recursos financeiros (seção 3)
- Anúncios, classificação de conteúdo, público-alvo (seção 8)
- Segurança dos dados (seção 8)
- **Só no OpenDriver**: declaração de serviço em primeiro plano (`FOREGROUND_SERVICE_LOCATION`
  e `FOREGROUND_SERVICE_MICROPHONE`) e declaração de localização em segundo plano. As duas
  pedem link de vídeo demonstrando a funcionalidade.

---

## Scripts que sustentam este documento

| Script | O que faz |
| --- | --- |
| `infra/server/43-conferir-legal-externo.ps1` | Confere as 9 páginas legais de fora: HTTP, razão social, CNPJ, e-mail em texto puro, ausência da ofuscação do Cloudflare |
| `infra/server/45-contas-demo.mjs` | Provisiona as três contas de demonstração em produção |
| `infra/server/46-conferir-contas-demo.mjs` | Confere login, aprovação, estado online e adesão de anunciante |
| `infra/server/47-conferir-sites-publicos.ps1` | Confere os endereços que vão na ficha |
| `infra/server/48-arte-lojas.ps1` | Gera os ícones 512×512 e os recursos gráficos 1024×500 |
| `infra/server/49-conferir-textos-loja.ps1` | Mede os textos da ficha contra os limites do Play |
| `infra/server/50-aab-todos.ps1` | Gera os três AAB em sequência, com o mesmo versionCode |
| `infra/server/51-conferir-aabs.ps1` | Confere os AAB em disco: assinatura, pacote, versionCode, permissões |
| `infra/server/52-ler-ficha-play.mjs` | Lê o estado atual da ficha de cada app no Play |
| `infra/server/53-publicar-ficha-play.mjs` | Sobe o AAB e grava ficha, imagens e contato pela API |
| `infra/server/54-diagnosticar-play.mjs` | Despeja faixas, versões e bundles sem resumir |
