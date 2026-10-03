# Publicação nas lojas — o que você faz, o que eu faço, e em que ordem

**Escrito em 3 de outubro de 2026**, depois de verificar os domínios, o e-mail e os três APKs
gerados. Complementa [`publicacao-lojas-ecossistema.md`](./publicacao-lojas-ecossistema.md),
que fez o levantamento; este documento é a sequência de execução.

---

## 0. Antes de qualquer coisa: três bloqueadores que eu confirmei hoje

Não são formulário de loja. São fatos que a revisão encontra sozinha, e dois deles são recusa
quase certa. Gastar dinheiro de conta de desenvolvedor antes de resolver estes é desperdício.

### 🔴 0.1 A política de privacidade do hub e do app do anunciante **não existe**

Confirmado no código, não por suposição. O SPA do hub (`src/routes/AppRoutes.tsx`) não registra
rota para `/privacidade` nem `/termos`. O que acontece:

1. o nginx do contêiner (`web.Dockerfile:17`, `try_files $uri /index.html`) devolve **200** com
   o `index.html` para qualquer caminho;
2. no navegador, o catch-all `<Route path="*" element={<Navigate to="/" replace />} />`
   (linha 211) **redireciona para a home**.

Então o revisor da Apple abre o link da política de privacidade e vê a página inicial da loja.
Por `curl` isso é indistinguível de uma página real — foi o que escondeu o problema até agora.

Afeta:

| App | Aponta para | Estado |
| --- | --- | --- |
| `hub-mobile` | `hub.opendriver.com.br/privacidade` e `/termos` | **morto** |
| `openad-advertiser` | `opendriver.com.br/privacidade` e `/termos` | **morto** (mesmo SPA) |
| `opendriver/mobile` | `api-app.opendriver.com.br/legal/*` | **funciona** |

O do opendriver funciona porque é servido pelo backend
(`backend/src/modules/legal/legal.routes.ts`), com política LGPD completa em 7 seções, CSP,
cache de 1 hora e **teste de integração** (`tests/integration/auth.test.ts:154`).

**Minha recomendação:** replicar esse padrão no backend do hub e na API do openad, em vez de
criar páginas no SPA. Três razões: é o padrão que já existe e está testado; página servida pelo
servidor não depende de JavaScript para o revisor ver conteúdo; e cada produto processa dados
diferentes — o hub coleta compra e cashback, o openad coleta dado de faturamento de anunciante,
o opendriver coleta localização e áudio. Uma política só não descreveria os três com honestidade.

**Posso fazer:** a rota, o HTML, o CSP, o cache, o teste, e o texto técnico derivado do código
(que dado é coletado de fato, por qual serviço, com que retenção, com quem é compartilhado).
**Não posso fazer:** a revisão jurídica e a razão social. O texto que eu escrever precisa passar
pelo seu advogado antes de ir ao ar.

### 🔴 0.2 Nenhum e-mail do ecossistema funciona

```
opendriver.com.br    MX    → "."                    (null MX: "este domínio não recebe e-mail")
opendriver.com.br    TXT   → v=spf1 -all            ("nenhum servidor pode enviar por aqui")
opendriver.com.br    DMARC → v=DMARC1; p=reject;    (falha de autenticação é descartada)
opendriverhub.com.br → sem MX, sem TXT, sem DMARC
```

Três consequências, em ordem de gravidade:

1. **`suporte@opendriver.com.br`** — o contato de suporte dos três apps — não recebe nada. As
   duas lojas exigem canal de suporte funcional; caixa morta é reprovação.
2. **A revisão da Apple cria uma conta** e espera o e-mail de verificação. Com `SPF -all` e
   `DMARC p=reject`, o destinatário recusa a mensagem. O revisor não confirma a conta e
   reprova por "não foi possível completar o cadastro".
3. Redefinição de senha fica igualmente quebrada para todo usuário real.

**Caminho curto (resolve hoje):** usar um endereço que já funcione — o próprio Gmail que o hub
tem configurado em `integration_settings` — como contato de suporte **e** como remetente.
**Caminho certo:** MX reais, SPF autorizando o provedor (`v=spf1 include:_spf.google.com -all`),
DKIM, e DMARC em `p=none` enquanto valida.

Isto é seu: eu não tenho acesso à zona de DNS nem ao provedor de e-mail.

### 🟡 0.3 Razão social e CNPJ não existem em lugar nenhum

No opendriver, `LEGAL_COMPANY` e `LEGAL_CONTACT_EMAIL`
(`backend/src/modules/legal/legal.routes.ts:12-13`) caem no padrão `'OpenDriver'` — que não é
razão social e não identifica o controlador dos dados, como a LGPD exige. Não há `.env` real
definindo os dois em nenhum dos repositórios, e nenhum CNPJ aparece em nenhum lugar.

As duas lojas pedem a entidade responsável. Me passe razão social, CNPJ e endereço, e eu
preencho nos três serviços.

---

## 1. O que só você pode fazer

Nada nesta lista é delegável — depende da sua identidade, do seu cartão ou do seu 2FA.

| # | O quê | Custo | Por que só você |
| --- | --- | --- | --- |
| 1.1 | **Google Play Console** — criar a conta | US$ 25, uma vez | Verificação de identidade com documento. Para conta de organização, exige CNPJ e endereço verificável (a Google manda carta ou valida por telefone) |
| 1.2 | **Apple Developer Program** — matrícula | US$ 99/ano | Identidade legal, **D-U-N-S Number** se for pessoa jurídica (a emissão leva de 5 a 14 dias), e 2FA num aparelho seu. A Apple não aceita delegação de matrícula |
| 1.3 | Aceitar contratos, declarações fiscais e bancárias nos dois consoles | — | Vinculados à sua identidade |
| 1.4 | Criar os registros dos apps nos consoles (3 no Play, 3 no App Store Connect) | — | Pode ser feito por mim depois, com as credenciais da §2 — mas o primeiro acesso precisa dos contratos aceitos |
| 1.5 | Responder os formulários de privacidade e classificação | — | São declarações legais em nome da empresa. Eu posso **redigir as respostas** com base no código; você revisa e envia |
| 1.6 | **Declaração de localização em segundo plano do Google Play**, com vídeo | — | Exige gravar a tela mostrando o fluxo real. Só o `opendriver/mobile` precisa |

> **Sobre o D-U-N-S:** se você for publicar como pessoa jurídica e ainda não tiver, peça
> **hoje**. É o item de maior prazo de toda a lista e bloqueia a matrícula da Apple.

---

## 2. O que você me passa

Peça por **credencial com escopo**, nunca senha de conta. Todas as três são revogáveis num
clique e não dão acesso ao resto da sua conta.

### 2.1 Google Play — chave de conta de serviço (JSON)

Como gerar:

1. Play Console → **Configurações** → **Acesso à API** → vincular um projeto do Google Cloud
2. **Criar conta de serviço** → abre o Google Cloud Console
3. Lá: criar conta de serviço → **Chaves** → **Adicionar chave** → tipo **JSON** → baixa o arquivo
4. De volta no Play Console → **Usuários e permissões** → conceder à conta de serviço o papel
   **Administrador de lançamentos** (*Release Manager*), restrito aos 3 apps

O que fazer com o arquivo — **não cole o conteúdo no chat**:

```powershell
# um por app, nos caminhos que o eas.json de cada um já espera
mkdir d:\Projetos\hub-mobile\secrets
mkdir d:\Projetos\opendriver\mobile\secrets
mkdir d:\Projetos\openad\app\openad-advertiser\secrets
# copie o JSON baixado para cada um como google-play-service-account.json
```

Os três `secrets/` já estão no `.gitignore`. Me avise o caminho e eu valido a chave sem
imprimir o conteúdo.

**Isso me permite:** criar faixas, subir AAB, promover entre faixas, ler o estado da revisão.
**Isso não me permite:** mexer em pagamento, em outros apps, ou na sua conta Google.

### 2.2 Apple — chave da API do App Store Connect

Como gerar:

1. App Store Connect → **Usuários e Acesso** → aba **Integrações** → **Chaves da API**
2. **Gerar chave**, papel **App Manager** (não precisa Admin)
3. Baixe o `.p8` — **a Apple deixa baixar uma única vez**
4. Anote o **Key ID** e o **Issuer ID** (o Issuer ID fica no topo da mesma página)

```powershell
mkdir d:\Projetos\.credenciais-loja
# copie o AuthKey_XXXXXXXXXX.p8 para lá
```

Me passe no chat apenas: **Key ID**, **Issuer ID** e o **caminho do .p8**. O conteúdo do
arquivo não precisa aparecer.

**Isso me permite:** criar o registro do app, subir build, gerir TestFlight, enviar para
revisão. **Isso não me permite:** mexer em contrato, em banco ou nos seus dados fiscais.

### 2.3 Expo — token de robô (necessário para iOS)

1. [expo.dev](https://expo.dev) → crie a conta ou a organização (plano gratuito serve para começar)
2. **Account Settings** → **Access Tokens** → **Create token** (tipo *Robot*, papel *Developer*)
3. Me passe: o **token** e o **slug do owner** (o nome da conta ou organização)

É com isso que eu crio os `EAS_PROJECT_ID` dos três apps e disparo os builds de iOS.

### 2.4 Assinatura do Android — minha recomendação

**Deixe o Google guardar a chave** (*Play App Signing*, que é o padrão desde 2021) e deixe o
EAS gerar e guardar a chave de upload. Motivo: chave de upload perdida é recuperável pelo
suporte da Google; chave de assinatura perdida, não — e aí o app **nunca mais** pode ser
atualizado, só republicado com outro pacote, perdendo todos os usuários.

Se você preferir guardar você mesmo, me diga e eu gero o keystore, te entrego, e aí a
responsabilidade do backup é sua.

---

## 3. A restrição técnica que nenhuma credencial resolve

**Build de iOS exige macOS.** Esta máquina é Windows: o Xcode não roda aqui, e não há como
compilar `.ipa` localmente. Duas saídas:

| | Como funciona | Custo | Prazo |
| --- | --- | --- | --- |
| **EAS Build** (recomendado) | compila num Mac na nuvem da Expo, com as credenciais da §2.2 e §2.3 | gratuito tem fila longa; plano pago ~US$ 99/mês | minutos a horas |
| Mac seu ou emprestado | `eas build --local` ou Xcode direto | — | você executa |

Android continua local, nesta máquina, como você preferiu — e foi a decisão certa: 16 a 30
minutos por APK aqui, contra fila na nuvem.

---

## 4. Ordem de execução

Os passos 1 a 5 são **pré-requisitos de build**, não de submissão. `EXPO_PUBLIC_*` é embutido
no bundle em tempo de compilação: fazer build antes deles é garantir build descartado.

```
SEMANA 0 — o que tem prazo externo
  1. [VOCÊ]  Pedir o D-U-N-S Number, se for publicar como PJ        (5 a 14 dias)
  2. [VOCÊ]  Decidir e corrigir o e-mail (§0.2)                      ← bloqueia a revisão
  3. [VOCÊ]  Me passar razão social, CNPJ e endereço (§0.3)

SEMANA 0 — em paralelo, comigo
  4. [EU]    Páginas legais no backend do hub e na API do openad (§0.1)
  5. [VOCÊ]  Revisão jurídica do texto que eu escrever
  6. [EU]    Inventário de produto digital do hub                    ← pode mudar o escopo do app
             (§3.1 do documento anterior: se houver produto consumido
              DENTRO do app, a Apple exige IAP)

SEMANA 1 — contas e registros
  7. [VOCÊ]  Criar Play Console (§1.1) e matricular na Apple (§1.2)
  8. [VOCÊ]  Gerar e me entregar as credenciais da §2
  9. [EU]    Criar os 6 registros de app, preencher ficha técnica,
             configurar EAS_PROJECT_ID nos três repositórios
 10. [EU]    Redigir as respostas dos formulários de privacidade
 11. [VOCÊ]  Revisar e enviar os formulários (§1.5)

SEMANA 1 — material de loja
 12. [EU]    Capturas de tela dos três apps num emulador             ← preciso instalar um AVD
 13. [EU]    Descrições, palavras-chave, categorias
 14. [EU]    Contas de demonstração em produção, com dado plausível:
             passageiro, motorista APROVADO e online, anunciante com
             campanha ativa e crédito
 15. [VOCÊ]  Gravar o vídeo da localização em segundo plano (§1.6)

SEMANA 2 — subir
 16. [EU]    typecheck + lint + test + export:check nos três apps
 17. [EU]    Build de produção (AAB no Android, IPA pelo EAS)
 18. [EU]    Subir em FAIXA INTERNA no Play e TestFlight interno
 19. [VOCÊ]  Instalar e usar de verdade, contra a API de produção
 20. [EU]    Promover para revisão, e acompanhar
```

> **Comece em faixa interna e TestFlight interno.** É gratuito, não passa por revisão, e você
> vê o app instalado de verdade antes de qualquer avaliador. O `eas.json` dos três já está
> configurado com `track: internal` e `releaseStatus: draft`.

---

## 5. O que eu já deixei pronto para isso

| Item | Estado |
| --- | --- |
| Exclusão de conta dentro do app (Apple 5.1.1(v), Google) | os três têm, e a do hub agora propaga para os outros dois serviços |
| Manifesto de privacidade do iOS | os três, com os 4 `NSPrivacyAccessedAPITypes` e código de motivo |
| `usesNonExemptEncryption: false` | os três |
| Permissões desnecessárias bloqueadas | os três; `SYSTEM_ALERT_WINDOW` corrigida hoje nos três (ver §6) |
| Textos de permissão em português, por finalidade | os três |
| Guarda de build contra URL `http://` | os três; recusa em tempo de compilação |
| Ícones e splash | `hub-mobile` e `opendriver/mobile` finais; `openad-advertiser` com placeholder funcional |
| `export:check` | passa nos três |
| APK de teste assinado | os três, gerados e inspecionados (§7) |

---

## 6. Um defeito que eu só vi olhando o APK

O APK de release do `hub-mobile` saiu com **`android.permission.SYSTEM_ALERT_WINDOW`** sem que
ela esteja declarada em nenhum arquivo do repositório. Ela entra por fusão de manifestos, vinda
do `expo-dev-client`.

Importa porque é permissão de alto risco: a Play Store exige justificativa por escrito, e é a
permissão usada em golpe de sobreposição de tela. Em app de marketplace não há uso legítimo.

- `openad-advertiser`: resolvido na origem — o `expo-dev-client` saiu das dependências (o app
  não tem módulo nativo fora do que o Expo Go já traz) e o bloqueio ficou como rede de segurança;
- `hub-mobile`: acrescentada a `blockedPermissions` hoje. **Precisa de rebuild** para valer;
- `opendriver/mobile`: já bloqueava.

Nenhuma leitura de configuração mostraria isso. Por isso o `scripts/apk.ps1` do app do
anunciante e o `infra/server/32-apks-mobile.ps1` **falham** se encontrarem permissão proibida
no artefato.

---

## 7. Os três APKs de teste

Gerados nesta máquina, variante `preview`, assinados, apontando para a API de produção.

| App | Caminho | Tamanho |
| --- | --- | --- |
| **App do anunciante** | `d:\Projetos\openad\app\openad-advertiser\android\app\build\outputs\apk\release\app-release.apk` | 105,8 MB |
| **hub-mobile** | `d:\Projetos\hub-mobile\android\app\build\outputs\apk\release\app-release.apk` | 132,8 MB |
| **opendriver/mobile** | `d:\Projetos\opendriver\mobile\android\app\build\outputs\apk\release\app-release.apk` | 155,1 MB |

São APK **universais**, com as quatro arquiteturas juntas — grandes de propósito, para instalar
em qualquer aparelho de teste. Os pacotes são os da variante `preview`
(`br.com.opendriver.ads.preview`, `br.com.opendriverhub.app.preview`,
`br.com.opendriver.app.preview`), então **convivem** com a versão de produção no mesmo
aparelho.

Para instalar por cabo:

```powershell
D:\dev\android-sdk\platform-tools\adb.exe install -r "d:\Projetos\openad\app\openad-advertiser\android\app\build\outputs\apk\release\app-release.apk"
```

Para gerar de novo:

```powershell
cd d:\Projetos\openad\app\openad-advertiser; .\scripts\apk.ps1 -Variante preview
powershell -File d:\Projetos\openad\infra\server\32-apks-mobile.ps1
```

Para a loja, o perfil `production` do `eas.json` gera **AAB**, e a Play Store entrega por
arquitetura — fica em torno de 30 MB por aparelho, não 130.

---

## 8. Resumo do que eu preciso de você para começar

Em ordem de urgência:

1. **Razão social, CNPJ e endereço** — desbloqueia as páginas legais e as duas fichas de loja
2. **Decisão sobre o e-mail**: endereço que funciona hoje, ou vou configurar MX/SPF/DKIM?
3. **D-U-N-S Number** pedido, se for PJ (é o item de maior prazo)
4. **JSON da conta de serviço do Google Play**, no `secrets/` de cada app
5. **Key ID, Issuer ID e caminho do `.p8`** da Apple
6. **Token de robô do Expo e slug do owner**
7. Decisão sobre iOS: EAS Build na nuvem ou você compila num Mac?

Com os itens 1 e 2 eu já começo as páginas legais, que é o caminho crítico. Os itens 4 a 6 só
são necessários na semana 1.
