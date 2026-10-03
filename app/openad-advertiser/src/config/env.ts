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
  privacyPolicy:
    process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://opendriver.com.br/privacidade',
  terms: process.env.EXPO_PUBLIC_TERMS_URL || 'https://opendriver.com.br/termos',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'suporte@opendriver.com.br',
} as const;
