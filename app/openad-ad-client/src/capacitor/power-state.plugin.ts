import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type PowerStateChangePayload = {
  /** True when external power is connected (e.g. USB / vehicle). */
  connected: boolean;
  /** Optional — native layer may include last-known battery % for watchdog (003). */
  batteryPercent?: number;
};

export interface PowerStatePluginContract {
  addListener(
    eventName: 'powerStateChange',
    listenerFunc: (payload: PowerStateChangePayload) => void
  ): Promise<PluginListenerHandle>;
}

/**
 * Android: native module registers `ACTION_POWER_CONNECTED` / `ACTION_POWER_DISCONNECTED`
 * and forwards events here. Web: no-op listener (tests can stub the plugin).
 */
export const PowerStatePlugin = registerPlugin<PowerStatePluginContract>(
  'PowerState',
  {
    web: () => ({
      addListener: async () => ({
        remove: async () => undefined,
      }),
    }),
  }
);
