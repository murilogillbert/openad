import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuração nativa do app do anunciante (CNG: `android/` e `ios/` são gerados no build).
 *
 * Duas URLs, e isso é o ponto central do app:
 *  EXPO_PUBLIC_HUB_API_URL   API do hub  — é lá que mora a **conta** (login, cadastro, refresh)
 *  EXPO_PUBLIC_ADS_API_URL   API do openad — é lá que moram **campanhas, criativos e relatórios**
 *
 * O mesmo access token vale nas duas: os três serviços do ecossistema assinam HS256 com o
 * mesmo `JWT_SECRET` e com `issuer`/`audience` iguais (`opendriverhub`). Quem renova o token é
 * o hub, porque é ele que emite — o openad valida e resolve o anunciante em
 * `openad.ad_advertisers`.
 *
 * Outras variáveis:
 *  APP_VARIANT               development | preview | production
 *  EAS_PROJECT_ID            necessário para build e atualização pelo EAS
 */
const VARIANT = (process.env.APP_VARIANT ?? 'development') as
  | 'development'
  | 'preview'
  | 'production';
const IS_PROD = VARIANT === 'production';
const SUFFIX = IS_PROD ? '' : VARIANT === 'preview' ? '.preview' : '.dev';

const BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'br.com.opendriver.ads';
const PACKAGE = process.env.ANDROID_PACKAGE ?? 'br.com.opendriver.ads';

const strip = (u: string) => u.replace(/\/+$/, '');
const HUB_API_URL = strip(process.env.EXPO_PUBLIC_HUB_API_URL ?? '');
const ADS_API_URL = strip(process.env.EXPO_PUBLIC_ADS_API_URL ?? '');

/**
 * Build de loja com URL `http://` é um app que vaza token de sessão em rede aberta. A recusa é
 * em tempo de **build**, e não um aviso em tempo de execução, porque em tempo de execução já é
 * tarde: o APK está publicado.
 *
 * Em `development` a validação não corre, para permitir apontar para `http://10.0.2.2:3000`
 * (o host visto de dentro do emulador Android).
 */
if (VARIANT !== 'development') {
  const problemas: string[] = [];
  if (!/^https:\/\//.test(HUB_API_URL)) {
    problemas.push(`EXPO_PUBLIC_HUB_API_URL deve ser https (recebido: "${HUB_API_URL}")`);
  }
  if (!/^https:\/\//.test(ADS_API_URL)) {
    problemas.push(`EXPO_PUBLIC_ADS_API_URL deve ser https (recebido: "${ADS_API_URL}")`);
  }
  if (problemas.length) {
    throw new Error(
      `Configuracao invalida para o build "${VARIANT}":\n- ${problemas.join('\n- ')}`
    );
  }
}

const NAVY = '#0A1726';
const FOTOS =
  'Suas fotos e vídeos são usados para enviar o criativo do anúncio que vai ser exibido nos veículos.';
const CAMERA = 'A câmera é usada para fotografar o criativo do anúncio na hora.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PROD ? 'OpenDriver Ads' : `OpenDriver Ads (${VARIANT === 'preview' ? 'Preview' : 'Dev'})`,
  slug: 'openad-advertiser',
  owner: process.env.EAS_OWNER || undefined,
  scheme: 'opendriverads',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F9FB',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: `${BUNDLE_ID}${SUFFIX}`,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleDevelopmentRegion: 'pt-BR',
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
      ],
    },
  },
  android: {
    package: `${PACKAGE}${SUFFIX}`,
    adaptiveIcon: {
      backgroundColor: NAVY,
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Nenhuma permissão de localização, microfone ou segundo plano: este app não rastreia
    // ninguém nem grava nada. Pedir permissão que não se usa é motivo de recusa nas lojas, e
    // piora a conversão na primeira tela.
    permissions: ['android.permission.CAMERA', 'android.permission.INTERNET'],
    blockedPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      /**
       * `SYSTEM_ALERT_WINDOW` ("desenhar sobre outros apps") entrava no APK **sem** ser
       * pedida — descoberto inspecionando o artefato com `aapt2 dump badging`, não lendo
       * configuração. A origem era o manifesto do `expo-dev-client`, por fusão de manifestos.
       *
       * A causa foi removida (o `expo-dev-client` saiu das dependências: este app não tem
       * módulo nativo fora do que o Expo Go já traz, então não precisa de dev client). O
       * bloqueio fica como rede de segurança, porque é permissão de alto risco — a Play Store
       * exige justificativa, e é a que golpes de sobreposição de tela usam.
       */
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    ['expo-secure-store', { faceIDPermission: false, configureAndroidBackup: true }],
    'expo-image',
    'expo-web-browser',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: NAVY,
      },
    ],
    ['expo-image-picker', { photosPermission: FOTOS, cameraPermission: CAMERA, microphonePermission: false }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant: VARIANT,
    hubApiUrl: HUB_API_URL,
    adsApiUrl: ADS_API_URL,
    router: {},
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
