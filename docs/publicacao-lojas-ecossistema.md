# Publicação nas lojas — ecossistema OpenDriver

> Escrito em 2026-10-02, depois de ler os quatro repositórios no código. Complementa
> [`producao-ecossistema.md`](./producao-ecossistema.md), que trata do servidor.
>
> Os dois documentos têm dependência cruzada: o `hub-mobile` depende da migration
> `push_tokens`, que é a §3 do guia de produção. Publicar antes dela é publicar com
> notificação quebrada.

---

## 1. Quatro aplicativos, dois vão para loja

| Aplicativo | Repositório | Loja? | Estado |
|---|---|---|---|
| **hub-mobile** — área do cliente do marketplace | `hub-mobile` | Sim, iOS e Android | Código maduro, EAS configurado. **Bloqueadores abaixo.** |
| **opendriver/mobile** — corridas | `opendriver/mobile` | Sim, iOS e Android | Código maduro, tem checklist próprio. **Bloqueadores abaixo.** |
| **Player do openad** — tablete no carro | `openad` | **Nunca** | Appliance. Device Owner e instalação silenciosa são motivo de recusa; entra por `dpm set-device-owner` e se atualiza pelo MDM do próprio repositório. |
| **App do anunciante (openad)** | — | Sim, no futuro | **Não existe.** Fase E do plano, 6 a 8 dias. Nenhum projeto Expo criado. |

Os dois primeiros são Expo 57 com `expo-router` e compartilham deliberadamente a camada
`src/api` — o `README` do `hub-mobile` diz que `http.ts`, `secureTokenStorage.ts`,
`components/ui/*`, `lib/*` e `theme/tokens.ts` são cópias de `opendriver/mobile`. Isso é bom
para consistência e ruim para correção de defeito: **o que você corrigir num, corrija no
outro**.

| | hub-mobile | opendriver/mobile |
|---|---|---|
| Bundle / package | `br.com.opendriverhub.app` | `br.com.opendriver.app` |
| Variantes | `''`, `.preview`, `.dev` | idem |
| API | `hubapi.opendriver.com.br` | `api-app.opendriver.com.br` |
| Categoria sugerida | Compras / Estilo de vida | Viagens / Mapas e navegação |

---

## 2. Três bloqueadores que valem para os dois, e um deles é certeza de recusa

Estes não são configuração de loja: são fatos de infraestrutura que a revisão vai encontrar.

### 2.1 🔴 O domínio do `hub-mobile` não existe

Verifiquei por DNS, agora:

```
opendriverhub.com.br   → NÃO RESOLVE
opendriverhub.com      → sem registro A, sem MX
hub.opendriver.com.br  → 172.67.130.94 / 104.21.8.49 (Cloudflare, proxiado)
hubapi.opendriver.com.br → resolve
```

O `hub-mobile` usa `https://opendriverhub.com.br` como `EXPO_PUBLIC_WEB_URL`, fixado no perfil
`base` do `eas.json` e como padrão em `src/config/env.ts`. Dele saem:

```ts
privacyPolicy: `${webUrl}/privacidade`
terms:         `${webUrl}/termos`
partnerArea:   `${webUrl}/parceiro`
```

**A Apple testa a URL da política de privacidade.** Link morto é recusa, não ressalva. E as
áreas de parceiro, admin e financeiro — que por desenho "seguem só na web" — ficam
inalcançáveis a partir do aplicativo.

O domínio que existe e está servindo é `hub.opendriver.com.br`. A correção é de uma linha, mas
tem de acontecer **antes do build**: `EXPO_PUBLIC_*` é embutido no bundle em tempo de
compilação, então corrigir depois exige build novo e nova submissão.

> Pode ser que vocês tenham `opendriverhub.com.br` registrado em outra zona que não a que eu
> vi. Se for o caso, só precisa apontar o DNS. Se não for, troque a URL.

### 2.2 🔴 Nenhum e-mail do ecossistema funciona

```
opendriver.com.br   MX → '.'            (null MX: "este domínio não recebe e-mail")
opendriver.com.br   TXT → v=spf1 -all   ("nenhum servidor pode enviar por este domínio")
opendriverhub.com   sem MX
```

Isso tem três consequências, em ordem de gravidade:

1. **`suporte@opendriverhub.com`**, o e-mail de suporte do `hub-mobile`
   (`src/config/env.ts:37`), está num domínio que não resolve. Note que falta o `.br` que todo
   o resto do ecossistema usa — provavelmente é erro de digitação **e** domínio errado.
2. As duas lojas exigem **canal de suporte funcional**. Caixa que não recebe é reprovação.
3. **Verificação de e-mail e redefinição de senha do hub vão para a caixa de spam ou são
   rejeitadas.** O hub envia por Gmail (`Email:GmailUser` em `integration_settings`), mas se o
   remetente for `@opendriver.com.br`, o SPF `-all` manda o destinatário recusar. O
   `hub-mobile` depende desses dois fluxos, e a revisão da Apple vai criar uma conta.

O que fazer, e é decisão de vocês:

- **Caminho curto:** usar um endereço que já funcione (o próprio Gmail configurado) como
  contato de suporte, e enviar os e-mails transacionais como esse endereço. Resolve hoje.
- **Caminho certo:** publicar MX reais para `opendriver.com.br` e trocar o SPF de `-all` para
  autorizar o Gmail (`v=spf1 include:_spf.google.com -all`), mais DKIM e um DMARC menos
  estrito que `p=reject` enquanto estiver validando. Hoje o DMARC está em `p=reject`, o que
  significa que **qualquer** falha de autenticação é descartada silenciosamente.

### 2.3 🟡 Razão social e CNPJ não existem em lugar nenhum

- `hub-mobile`: a tela `src/app/sobre.tsx` mostra produto, e-mail, site, termos, privacidade e
  versão. **Nenhuma entidade legal.**
- `opendriver/mobile`: o `publicacao-lojas.md` dele registra que a política de privacidade e os
  termos estão com `LEGAL_COMPANY` e `LEGAL_CONTACT_EMAIL` **fictícios**, por decisão
  consciente durante os testes, e diz: precisa dos dados reais antes de publicar de verdade.

As duas lojas pedem a entidade responsável, e a política de privacidade precisa identificar o
controlador dos dados — é exigência da LGPD também, não só da loja. Isso é informação que só
vocês têm e bloqueia as duas submissões.

---

## 3. hub-mobile

### 3.1 O risco de recusa mais sério: produto digital sem IAP

É o único item que eu classificaria como risco de produto, não de configuração.

O raciocínio está registrado em `docs/plano-implementacao.md` do `hub-mobile`: produto digital
é "benefício resgatado por QR/código **fora do app** — mesma isenção dos vouchers, **sem
In-App Purchase**". A conclusão é defensável: se o benefício é resgatado no balcão, é serviço
físico e a regra 3.1.3(e) da Apple permite pagamento externo.

**Mas o próprio documento marca a mitigação como não feita:** "inventariar antes de submeter",
e o item segue listado como severidade **alta**. Ou seja, a decisão está apoiada no *schema*,
não nos dados reais. Ninguém olhou quais linhas de `ProductKind = digital` existem em produção.

Faça esse inventário antes de submeter:

```sql
SELECT kind, COUNT(*) FROM public.products GROUP BY kind;
-- e, para os digitais, o que são de fato:
SELECT id, name, kind FROM public.products WHERE kind = 'digital' LIMIT 50;
```

> Confira o nome real da tabela e da coluna no `schema.prisma` do hub antes de rodar; escrevi
> de memória do modelo.

O critério de decisão: **o benefício é consumido dentro do aplicativo ou fora dele?** Curso que
abre no app, assinatura que libera conteúdo no app, crédito gasto no app → a Apple exige IAP,
com 15 a 30% de comissão. Cupom, voucher, código resgatado no balcão ou em outro site →
isenção vale.

Se existir um só produto do primeiro tipo, há três saídas: remover do catálogo do aplicativo
(mantendo na web), implementar IAP para ele, ou tratá-lo como resgate externo de fato. A pior
saída é submeter e descobrir na revisão.

### 3.2 Pendências de configuração

| Item | Onde | Observação |
|---|---|---|
| `ascAppId` | `eas.json:52` | Literalmente `"PREENCHER_APP_STORE_CONNECT_APP_ID"`. Vem do App Store Connect depois de criar o registro do app. |
| Chave de serviço do Google Play | `./secrets/google-play-service-account.json` | O caminho está configurado, **o diretório `secrets/` não existe**. Gere no Google Cloud, vincule no Play Console. Está no `.gitignore` — não comite. |
| `EAS_PROJECT_ID` | variável de ambiente | O `extra.eas` só é preenchido se ela existir, e **sem ela o push não funciona no build**. Não há `.env.example` neste repositório documentando isso. |
| Screenshots | — | Não existe nenhuma. Precisa iPhone 6,7" e 6,5", e telefone Android. |
| Descrição, palavras-chave, categoria, classificação etária | consoles | Nada preparado. |
| Conta de demonstração | — | A revisão precisa conseguir navegar o catálogo, fazer um pedido e ver o voucher. Com pagamento em `mock` isso funciona; com Asaas real, precisa de um produto de valor simbólico. |

### 3.3 O que já está pronto, e é bastante

Vale registrar para não ser refeito:

- **Exclusão de conta no aplicativo** (Apple 5.1.1(v)): tela `src/app/conta/excluir.tsx`, com
  confirmação de senha, caixa de ciência e diálogo, chamando `POST /me/delete`. A tela é
  honesta ao dizer que o servidor anonimiza em vez de apagar, e que a exclusão é recusada
  enquanto houver pedido aberto.
- **Manifesto de privacidade do iOS** completo: `NSPrivacyTracking: false`, listas de domínios
  e de dados coletados vazias, e quatro `NSPrivacyAccessedAPITypes` com código de motivo
  (UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1`, DiskSpace `E174.1`).
- `usesNonExemptEncryption: false`.
- **Permissões desnecessárias bloqueadas** no Android: armazenamento externo (leitura e
  escrita), localização em segundo plano e microfone. Pede só câmera, localização aproximada e
  precisa, notificação e vibração.
- Textos de permissão em português, específicos por finalidade.
- Ícones e splash completos, incluindo o conjunto adaptativo do Android.
- **Guarda de build:** o `app.config.ts` lança erro se `EXPO_PUBLIC_API_URL` ou
  `EXPO_PUBLIC_WEB_URL` não forem https em `preview` ou `production`. Boa rede de proteção —
  mas ela valida o esquema, **não** se o domínio existe, que é exatamente o furo da §2.1.
- Camada `src/api` com envelope, refresh em voo único, guarda de geração de sessão e
  armazenamento seguro com marca de instalação.

### 3.4 Duas lacunas funcionais conhecidas

- **Deep link não volta para o aplicativo** (`README.md:85-89`): verificação de e-mail e
  redefinição de senha montam a URL a partir do `FRONTEND_URL` do backend e abrem o navegador.
  O usuário verifica e fica no navegador. Não é recusa, é atrito — e combina mal com a §2.2.
- **Sem CI.** Não existe `.github/workflows`. Os portões de qualidade são scripts manuais:
  `typecheck`, `lint`, `test`, `export:check`. E a cobertura é fina: **dois arquivos de teste
  para cerca de sessenta de código**, sendo um deles o `setup.ts`. Histórico de um único commit.

Minha opinião: rodar `export:check` antes de qualquer build de loja é obrigatório, porque é o
que garante que todas as rotas compilam. É o mesmo portão que o `opendriver/mobile` usa.

---

## 4. opendriver/mobile

Este tem checklist próprio e detalhado em `opendriver/docs/publicacao-lojas.md`. Não vou
duplicá-lo; o que segue é o que muda agora que as contas Apple e Google existem, mais o que eu
destacaria.

### 4.1 Desbloqueado pelas contas

- `ascAppId` no `eas.json` e chave de serviço do Google Play em `mobile/secrets/` — eram
  placeholder justamente esperando as contas.

### 4.2 O que continua pendente

- Screenshots, descrição, palavras-chave, categoria Viagens, classificação etária.
- **Conta de demonstração**: passageiro **e** motorista aprovado, com um motorista de
  demonstração online numa região de teste. A revisão da Apple precisa **pedir e aceitar uma
  corrida de verdade**. É o item mais subestimado da lista inteira: exige um fluxo de corrida
  funcionando no momento da revisão, não só telas.
- **Formulário do Google Play para localização em segundo plano, com vídeo curto** mostrando
  ficar online → notificação persistente → oferta chegando. O tipo de serviço em primeiro plano
  declarado é `location`.
- Segundo webhook do Asaas — é a Janela 3 do guia de produção.
- Razão social e e-mail reais (§2.3).
- `mobile/assets/brand/logo-source.png` está em 191×185, baixa resolução. Só importa se for
  regenerar os ícones a partir dele.

### 4.3 O que já está atendido

O checklist dele registra, entre outros: exclusão de conta no app, textos de permissão,
localização em segundo plano **somente para motorista online** com notificação persistente,
microfone só com gravação de segurança ativada pelo usuário, pagamento de corrida fora do IAP
(3.1.3(e)), manifesto de privacidade, e a tabela de segurança dos dados pronta para os dois
formulários — com "Rastreamento para publicidade: **Não**".

> **Atenção para quando o openad entrar:** essa declaração de "sem rastreamento para
> publicidade" é do aplicativo de corridas, e **não pode mudar** por causa do openad. O
> `opendriver/mobile` não faz e não deve fazer atribuição de anúncio. O aplicativo do
> anunciante, quando existir, terá manifesto de privacidade próprio e diferente.

---

## 5. App do anunciante (openad) — ainda não existe

Não há nenhum projeto Expo no repositório do openad. É a Fase E do
[`plano-ecossistema-e-mobile.md`](./plano-ecossistema-e-mobile.md).

Duas restrições de loja que precisam entrar no desenho **desde o começo**, não no fim:

1. **Os SKUs de IAP têm de estar cadastrados nos dois consoles antes da primeira build de
   revisão**, e em estado "pronto para enviar", com captura de tela. Produto de IAP é SKU fixo:
   não dá para cobrar "R$ 1.247,30, que é o custo desta campanha". O modelo é pacote de crédito
   (50 / 100 / 500 / 2.000), do tipo *consumable*.
2. **O crédito não pode ser conversível em dinheiro.** É a razão de `ad_credit_ledger` existir
   separado da carteira do hub: `users.cashback_balance` é sacável, e saldo comprado por IAP
   que vira dinheiro sacável é recusado como valor armazenado. Essa separação já está
   implementada no schema `openad`.

E a conta de demonstração precisa ter **crédito e campanha ativa** — revisão que esbarra em
tela vazia volta como "funcionalidade incompleta".

---

## 6. Ordem recomendada

Opinião, com o motivo de cada passo:

```
1. Decidir e corrigir domínio e e-mail (§2.1, §2.2)        ← antes de qualquer build
2. Razão social e CNPJ nas páginas legais (§2.3)
3. Migration push_tokens (§3 do guia de produção)          ← senão publica com push quebrado
4. Inventário de produto digital no hub (§3.1)             ← pode mudar o escopo do app
5. Asaas real (Janela 3 do guia de produção)               ← revisão vê o fluxo real
6. Registros nos consoles: ascAppId, chave do Play, EAS_PROJECT_ID
7. Screenshots, descrições, formulários de privacidade
8. Contas de demonstração, com motorista aprovado e online
9. export:check, typecheck, lint nos dois aplicativos
10. Build de produção pelo EAS e submissão em faixa interna primeiro
```

Os passos 1 a 4 são **pré-requisitos de build**, não de submissão: `EXPO_PUBLIC_*` é embutido
no bundle em tempo de compilação, e o inventário de produto digital pode mudar o que vai no
aplicativo. Fazer build antes deles é garantir build descartado.

Comece em **faixa interna** (`track: internal`, `releaseStatus: draft` já é o que o `eas.json`
do `hub-mobile` configura) e em **TestFlight interno**. Você vê o aplicativo instalado de
verdade, com a API de produção, antes de qualquer avaliador.

---

## 7. O que eu não verifiquei

Honestidade sobre o alcance desta análise:

- Não rodei `typecheck`, `lint`, `test` nem `export:check` em nenhum dos dois aplicativos. Não
  sei se passam hoje.
- Não verifiquei se `hub.opendriver.com.br/privacidade` e `/termos` existem e têm conteúdo
  válido — só que o domínio resolve. **Confira as duas páginas abrindo no navegador**; a Apple
  vai abrir.
- Não tenho acesso aos consoles da Apple e do Google, então não sei o que já existe lá.
- Não li o `hub-mobile` inteiro: olhei identidade, EAS, camada de API, autenticação, push,
  pagamento e o que está marcado como pendente. Telas individuais não foram revisadas.
- O `docs/plano-implementacao.md` do `hub-mobile` **não é fonte confiável de estado**: todas as
  tarefas das Fases 0 a 6 estão desmarcadas apesar de o código existir, e o cabeçalho ainda diz
  "nenhum código foi escrito ainda". Ele foi escrito antes e nunca atualizado.
