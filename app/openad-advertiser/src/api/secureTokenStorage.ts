import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { TokenPair, TokenStorage } from './http';

/**
 * Prefixo `openad.`, **não** `odh.`.
 *
 * O app do passageiro/motorista usa `odh.accessToken` no mesmo Keychain/Keystore. No iOS, dois
 * apps só compartilham Keychain com o mesmo access group — o que não é o caso aqui —, mas usar
 * a mesma chave convidaria o erro no dia em que alguém configurasse compartilhamento, e
 * tornaria impossível ter as duas sessões ao mesmo tempo num cenário de teste com os dois
 * bundles. Namespace separado custa nada e remove a classe de problema.
 */
const ACCESS_KEY = 'openad.accessToken';
const REFRESH_KEY = 'openad.refreshToken';
const INSTALL_MARKER = 'openad.installMarker';

// Keychain (iOS) / Keystore (Android). THIS_DEVICE_ONLY: não vai para backup nem migra para
// outro aparelho. AFTER_FIRST_UNLOCK: permite o refetch ao voltar do background com a tela
// recém-bloqueada.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Tokens no armazenamento seguro do sistema, com cache em memória — o SecureStore é lento
 * para ler a cada requisição.
 */
export function createSecureTokenStorage(): TokenStorage & { init(): Promise<void> } {
  let cache: { access: string | null; refresh: string | null } | null = null;

  async function load() {
    if (!cache) {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY, OPTIONS),
        SecureStore.getItemAsync(REFRESH_KEY, OPTIONS),
      ]);
      cache = { access, refresh };
    }
    return cache;
  }

  return {
    /**
     * O Keychain do iOS sobrevive à desinstalação do app: sem isto, reinstalar "logaria"
     * sozinho com a sessão antiga. O AsyncStorage é apagado na desinstalação, então a ausência
     * do marcador significa instalação nova.
     */
    async init() {
      try {
        const marker = await AsyncStorage.getItem(INSTALL_MARKER);
        if (!marker) {
          await Promise.all([
            SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
            SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
          ]);
          await AsyncStorage.setItem(INSTALL_MARKER, '1');
          cache = { access: null, refresh: null };
        }
      } catch (err) {
        console.warn('Falha ao verificar instalacao nova', err);
      }
    },
    async getAccessToken() {
      return (await load()).access;
    },
    async getRefreshToken() {
      return (await load()).refresh;
    },
    async setTokens({ token, refreshToken }: TokenPair) {
      cache = { access: token, refresh: refreshToken };
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, token, OPTIONS),
        SecureStore.setItemAsync(REFRESH_KEY, refreshToken, OPTIONS),
      ]);
    },
    async clear() {
      cache = { access: null, refresh: null };
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
        SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
      ]);
    },
  };
}
