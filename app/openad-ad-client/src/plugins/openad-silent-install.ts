import { registerPlugin } from '@capacitor/core';

export interface OpenAdSilentInstallPlugin {
  installApkFromCache(options: { filename: string }): Promise<{ sessionId: number }>;
}

export const OpenAdSilentInstall = registerPlugin<OpenAdSilentInstallPlugin>(
  'OpenAdSilentInstall'
);
