import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openad.adclient',
  appName: 'OpenAD Ad Client',
  /** Angular 21 client bundle lives under `browser/`; `nx run openad-ad-client:cap-sync` copies `index.csr.html` → `index.html` before sync. */
  webDir: '../../dist/app/openad-ad-client/browser',
  android: {
    path: 'android',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
