# OpenDriver Ads — app do anunciante

App Expo (React Native) pelo qual o anunciante cria campanha, sobe criativo, envia para
moderação e acompanha quantas vezes o anúncio foi exibido de verdade nas telas dos veículos.

## Por que é um projeto autônomo

Tem `package.json` e `node_modules` próprios, e **não** é membro de workspace do monorepo.
React Native 0.86 com React 19 não convive com Angular 21 + NestJS na mesma árvore de
dependências; tentar unificar produziria resolução de versão impossível de satisfazer. O
`.nxignore` da raiz mantém esta pasta fora do grafo do Nx, para que `nx run-many` não tente
rodar alvos aqui.

```bash
cd app/openad-advertiser
npm install
```

## As duas APIs

| Variável | Para quê |
| --- | --- |
| `EXPO_PUBLIC_HUB_API_URL` | API do **hub**: login, cadastro, refresh, perfil |
| `EXPO_PUBLIC_ADS_API_URL` | API do **openad**: campanhas, criativos, relatórios |

O mesmo access token vale nas duas: os três serviços assinam HS256 com o mesmo `JWT_SECRET` e
com `issuer`/`audience` iguais (`opendriverhub`). Quem **renova** é o hub, porque é ele que
emite — o cliente HTTP do openad delega a renovação ao do hub (`refreshDelegate` em
`src/api/client.ts`). Sem essa delegação, um 401 do openad tentaria renovar no openad, que
recusa refresh token do hub, e o anunciante seria deslogado a cada expiração com a sessão
perfeitamente válida.

## Adesão

Conta do ecossistema **não é** conta de anunciante. Enquanto não existir linha em
`openad.ad_advertisers`, `/advertiser/*` responde **401** — `FederatedJwtStrategy` resolve o
anunciante no banco e devolve `null` sem ela.

Por isso o `AuthContext` tem quatro estados e não três: `carregando`, `deslogado`,
`precisaAderir` e `pronto`. Tratar `precisaAderir` como "sessão expirou" jogaria o anunciante
de volta ao login num laço, com a senha certa.

A adesão é uma tela (`/adesao`), não um efeito automático da autenticação: a chamada grava
cadastro de parceiro comercial que alimenta relatório de faturamento. Fazer isso sozinho na
primeira abertura transformaria qualquer curioso em parceiro.

## Dinheiro

Centavos inteiros em tudo que vem e vai para a API; os campos têm sufixo `Cents`. A conversão
para reais acontece **só** em `src/lib/dinheiro.ts`. Não é zelo de tipagem: a conversão
espalhada foi exatamente o defeito corrigido na API, onde custou orçamento consumido cem vezes
mais rápido que o contratado.

## Rodar

```bash
npm start                 # Metro; abra no Expo Go ou num dev client
npm run android           # build nativo local (precisa de Android SDK)
npm run typecheck
npm run lint
npm test
npm run export:check      # valida que o bundle de produção fecha
```

Em desenvolvimento no emulador Android, o padrão usa `10.0.2.2` — o host visto de dentro do
emulador. `localhost` ali aponta para o próprio emulador, e é a causa mais comum de "sem
conexão com o servidor" com tudo funcionando no navegador da máquina.

## APK

```bash
# Local, sem EAS: gera o projeto nativo e compila
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
```

Ou pelo EAS (`eas.json` já tem os três perfis):

```bash
eas build --platform android --profile preview   # APK para instalar direto
eas build --platform android --profile production # AAB para a Play Store
```

O perfil `preview` e `production` **recusam** URL `http://` em tempo de build
(`app.config.ts`): um APK publicado apontando para HTTP vaza token de sessão em rede aberta, e
em tempo de execução já seria tarde para descobrir.

## Ícones

`assets/*.png` são **placeholder funcional** gerados por `npm run icones` — quadrados na paleta
do produto. Existem porque `expo prebuild` falha sem eles. Arte final substitui os arquivos
mantendo nomes e tamanhos.
