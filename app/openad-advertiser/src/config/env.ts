import Constants from 'expo-constants';

type Variant = 'development' | 'preview' | 'production';

interface Extra {
  variant?: Variant;
  hubApiUrl?: string;
  adsApiUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
const strip = (url: string) => url.replace(/\/+$/, '');

/**
 * `EXPO_PUBLIC_*` é embutido no bundle em tempo de build; `extra` (de `app.config.ts`) é o
 * fallback do mesmo build. Em builds de loja o `app.config.ts` já recusou URL que não seja
 * https, então aqui não há o que validar de novo.
 *
 * Os padrões de desenvolvimento usam `10.0.2.2`, que é o host visto de dentro do emulador
 * Android — `localhost` ali aponta para o próprio emulador, e é a causa mais comum de
 * "sem conexão com o servidor" com tudo funcionando no navegador da máquina.
 */
const hubApiUrl = strip(
  process.env.EXPO_PUBLIC_HUB_API_URL || extra.hubApiUrl || 'http://10.0.2.2:4000'
);
const adsApiUrl = strip(
  process.env.EXPO_PUBLIC_ADS_API_URL || extra.adsApiUrl || 'http://10.0.2.2:3000'
);

export const env = {
  variant: (extra.variant ?? 'development') as Variant,

  /** Origem da API do hub (sem `/api/v1`). É onde mora a conta do ecossistema. */
  hubApiUrl,
  /** Base das rotas do hub. Login, cadastro, refresh e perfil. */
  hubBaseUrl: `${hubApiUrl}/api/v1`,

  /** Origem da API do openad (sem `/api/v1`). É onde moram campanhas e relatórios. */
  adsApiUrl,
  adsBaseUrl: `${adsApiUrl}/api/v1`,
} as const;

/** As lojas exigem URL pública de política de privacidade e canal de suporte. */
export const links = {
  /**
   * As páginas legais são servidas pela **API do openad**, não pelo site.
   *
   * `opendriver.com.br/privacidade` e `/termos` **não existem**: o roteador do SPA do hub não
   * registra esses caminhos, o nginx devolve `index.html` com status 200 para qualquer caminho
   * e o catch-all do roteador redireciona para a home. O revisor da Apple abriria o link da
   * política e veria a página inicial da loja do hub — e por `curl` isso é indistinguível de
   * uma página real.
   *
   * O openad tem páginas próprias porque trata dados diferentes do hub e do opendriver:
   * faturamento de anunciante e conteúdo de criativo, não compra nem localização. Política
   * imprecisa é pior que ausente — ela afirma coisa errada sobre tratamento de dado pessoal.
   */
  privacyPolicy:
    process.env.EXPO_PUBLIC_PRIVACY_URL || `${adsApiUrl}/legal/privacidade`,
  terms: process.env.EXPO_PUBLIC_TERMS_URL || `${adsApiUrl}/legal/termos`,

  /**
   * Caixa que **recebe de verdade**, conferido por DNS.
   *
   * `suporte@opendriver.com.br` não recebia nada: o domínio publica `MX .` (null MX, que
   * declara "este domínio não recebe e-mail"), `SPF -all` e `DMARC p=reject`. As duas lojas
   * exigem canal de suporte funcional, e caixa morta é reprovação.
   */
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'murilogillbert@gmail.com',
} as const;
