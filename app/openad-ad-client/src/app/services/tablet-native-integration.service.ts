import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { Fullscreen } from '@boengli/capacitor-fullscreen';
import { CapacitorAndroidKiosk } from '@capgo/capacitor-android-kiosk';
import { CapacitorAccelerometer } from '@capgo/capacitor-accelerometer';
import { CapgoBrightness } from '@capgo/capacitor-brightness';
import { CapgoCompass } from '@capgo/capacitor-compass';
import { LightSensor } from '@capgo/capacitor-light-sensor';
import { CapacitorWifi } from '@capgo/capacitor-wifi';
import type { TelemetryPayload } from '@openad/mqtt-contracts';
import {
  VolumeControl,
  VolumeType,
} from '@odion-cloud/capacitor-volume-control';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';

const KIOSK_PREFS_KEY = 'openad_kiosk_auto_enter';
const FULLSCREEN_PREFS_KEY = 'openad_fullscreen_enabled';
const KIOSK_DISABLED_UNTIL_KEY = 'openad_kiosk_disabled_until';

/**
 * Wires Capacitor native plugins (sensors, kiosk, privacy, keep-awake, background task, Wi‑Fi, etc.)
 * for telemetry and lifecycle. No-ops on web / SSR.
 */
@Injectable({ providedIn: 'root' })
export class TabletNativeIntegrationService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mqtt = inject(MqttClientService);

  private started = false;
  private privacyWhenBackgrounded = true;
  private keepAwakeEnabled = false;
  private latestLux: number | null = null;
  private latestAccel: { x: number; y: number; z: number } | null = null;
  private handles: PluginListenerHandle[] = [];
  private kioskReentryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * `taskId` do @capawesome/capacitor-background-task e `string`; estava declarado como
   * `number`, o que fazia o typecheck do ad-client falhar em tres pontos e, com isso,
   * `nx run openad-ad-client:build` nao concluir.
   */
  private kioskBgTaskId: string | null = null;

  isCapacitorNative(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    return Capacitor.isNativePlatform();
  }

  /** Call once from `APP_INITIALIZER` on the browser bundle. */
  async initialize(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.isCapacitorNative() || this.started) {
      return;
    }
    this.started = true;

    await this.wireKeepAwake();
    await this.wireFullscreenFromPreferences();
    await PrivacyScreen.disable().catch(() => undefined);
    this.privacyWhenBackgrounded = false;
    await this.wirePrivacyAndBackgroundTask();
    await this.wireKioskPolicy();
    await this.startLightSensor();
    await this.startAccelerometer();
    await Geolocation.requestPermissions().catch(() => undefined);
    await CapgoCompass.requestPermissions().catch(() => undefined);
    await CapacitorWifi.requestPermissions().catch(() => undefined);

    this.destroyRef.onDestroy(() => {
      for (const h of this.handles) {
        void h.remove();
      }
      this.handles = [];
      if (this.kioskReentryTimer) {
        clearTimeout(this.kioskReentryTimer);
        this.kioskReentryTimer = null;
      }
      void LightSensor.stop().catch(() => undefined);
      void CapacitorAccelerometer.stopMeasurementUpdates().catch(() => undefined);
    });
  }

  private async wireKeepAwake(): Promise<void> {
    try {
      const sup = await KeepAwake.isSupported();
      if (sup.isSupported) {
        await KeepAwake.keepAwake();
        this.keepAwakeEnabled = true;
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Tela cheia imersiva, ligada por padrao.
   *
   * Era `value === 'true'`, ou seja, **opt-in por uma preferencia que nada no aplicativo
   * escrevia**. O modo imersivo nunca ativava: o player abria com barra de status e barra de
   * navegacao sobre o anuncio, e a unica forma de ligar era gravar a chave a mao.
   *
   * Agora segue a mesma convencao do quiosque em `wireKioskPolicy`: ausente vale como
   * ligado, e so `'false'` explicito desliga. Para um painel de sinalizacao esse e o padrao
   * correto — e, sem Device Owner, o imersivo e o que mais aproxima do quiosque, porque o
   * Lock Task sem allowlist exige confirmacao na tela.
   */
  private async wireFullscreenFromPreferences(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: FULLSCREEN_PREFS_KEY });
      if (value !== 'false') {
        await Fullscreen.activateImmersiveMode();
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Reaplica o imersivo ao voltar para o primeiro plano.
   *
   * O Android abandona o modo imersivo quando a Activity perde o foco — notificacao em tela
   * cheia, chamada, desligar e ligar a tela. Sem reaplicar, o painel volta com as barras do
   * sistema por cima do anuncio e fica assim ate o proximo reinicio do aplicativo.
   */
  private async reaplicarImersivo(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: FULLSCREEN_PREFS_KEY });
      if (value === 'false') {
        return;
      }
      await Fullscreen.activateImmersiveMode();
    } catch {
      /* ignore */
    }
  }

  private async wirePrivacyAndBackgroundTask(): Promise<void> {
    try {
      const appListener = await App.addListener('appStateChange', async ({ isActive }) => {
        try {
          if (isActive) {
            await PrivacyScreen.disable();
            this.privacyWhenBackgrounded = false;
            await this.reaplicarImersivo();
            await this.ensureMqttConnected();
          } else {
            await PrivacyScreen.enable();
            this.privacyWhenBackgrounded = true;
            await this.maybeHoldBackgroundTaskForKioskWindow();
          }
        } catch {
          /* ignore */
        }
      });
      this.handles.push(appListener);
    } catch {
      /* ignore */
    }
  }

  private async ensureMqttConnected(): Promise<void> {
    try {
      const deviceId = this.mqtt.getActiveDeviceId();
      if (!deviceId) {
        return;
      }
      if (!this.mqtt.isConnected()) {
        await this.mqtt.attachDevice(deviceId);
      }
    } catch {
      /* ignore */
    }
  }

  private async maybeHoldBackgroundTaskForKioskWindow(): Promise<void> {
    const disabledUntil = await this.getKioskDisabledUntilMs();
    if (!disabledUntil || disabledUntil <= Date.now()) {
      return;
    }
    try {
      if (this.kioskBgTaskId != null) {
        BackgroundTask.finish({ taskId: this.kioskBgTaskId });
        this.kioskBgTaskId = null;
      }
    } catch {
      /* ignore */
    }
    try {
      const id = await BackgroundTask.beforeExit(() => {
        BackgroundTask.finish({ taskId: id });
      });
      this.kioskBgTaskId = id;
      await this.ensureMqttConnected();
    } catch {
      /* ignore */
    }
  }

  private async wireKioskPolicy(): Promise<void> {
    try {
      const disabledUntil = await this.getKioskDisabledUntilMs();
      if (disabledUntil && disabledUntil > Date.now()) {
        this.scheduleKioskReentry(disabledUntil);
        return;
      }
      const { value } = await Preferences.get({ key: KIOSK_PREFS_KEY });
      // Treat unset as enabled for kiosk deployments; only explicit "false" disables auto-enter.
      if (value !== 'false') {
        await CapacitorAndroidKiosk.enterKioskMode();
      }
    } catch {
      /* ignore */
    }
  }

  async temporarilyDisableKiosk(durationSeconds: number): Promise<{ disabledUntilIso: string }> {
    const clampedSeconds = Math.max(30, Math.min(3600, Math.floor(durationSeconds)));
    const disabledUntilMs = Date.now() + clampedSeconds * 1000;
    const disabledUntilIso = new Date(disabledUntilMs).toISOString();

    try {
      await Preferences.set({
        key: KIOSK_DISABLED_UNTIL_KEY,
        value: String(disabledUntilMs),
      });
    } catch {
      /* ignore */
    }

    try {
      if (this.isCapacitorNative()) {
        await CapacitorAndroidKiosk.exitKioskMode();
      }
    } catch {
      /* ignore */
    }

    await this.maybeHoldBackgroundTaskForKioskWindow();
    this.scheduleKioskReentry(disabledUntilMs);
    return { disabledUntilIso };
  }

  private async getKioskDisabledUntilMs(): Promise<number | null> {
    try {
      const { value } = await Preferences.get({ key: KIOSK_DISABLED_UNTIL_KEY });
      if (!value) {
        return null;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return Math.floor(n);
    } catch {
      return null;
    }
  }

  private scheduleKioskReentry(disabledUntilMs: number): void {
    if (this.kioskReentryTimer) {
      clearTimeout(this.kioskReentryTimer);
      this.kioskReentryTimer = null;
    }
    const delayMs = Math.max(0, disabledUntilMs - Date.now());
    this.kioskReentryTimer = setTimeout(() => {
      void this.reenterKioskAfterDisableWindow();
    }, delayMs);
  }

  private async reenterKioskAfterDisableWindow(): Promise<void> {
    this.kioskReentryTimer = null;
    try {
      await Preferences.remove({ key: KIOSK_DISABLED_UNTIL_KEY });
    } catch {
      /* ignore */
    }
    try {
      if (this.kioskBgTaskId != null) {
        BackgroundTask.finish({ taskId: this.kioskBgTaskId });
        this.kioskBgTaskId = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.isCapacitorNative()) {
        await CapacitorAndroidKiosk.enterKioskMode();
      }
    } catch {
      /* ignore */
    }
  }

  private async startLightSensor(): Promise<void> {
    try {
      const { available } = await LightSensor.isAvailable();
      if (!available) {
        return;
      }
      await LightSensor.requestPermissions().catch(() => undefined);
      await LightSensor.start({ updateInterval: 2000 });
      const h = await LightSensor.addListener('lightSensorChange', (m) => {
        this.latestLux = m.illuminance;
      });
      this.handles.push(h);
    } catch {
      /* ignore */
    }
  }

  private async startAccelerometer(): Promise<void> {
    try {
      await CapacitorAccelerometer.requestPermissions().catch(() => undefined);
      await CapacitorAccelerometer.startMeasurementUpdates();
      const h = await CapacitorAccelerometer.addListener('measurement', (m) => {
        this.latestAccel = { x: m.x, y: m.y, z: m.z };
      });
      this.handles.push(h);
    } catch {
      /* ignore */
    }
  }

  async getLocationSnapshot(): Promise<TelemetryPayload['location']> {
    if (!this.isCapacitorNative()) {
      return this.browserGeoFallback();
    }
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 60_000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
        gpsLocked: true,
      };
    } catch {
      return { lat: 0, lng: 0, accuracyMeters: 999, gpsLocked: false };
    }
  }

  private browserGeoFallback(): Promise<TelemetryPayload['location']> {
    if (!isPlatformBrowser(this.platformId) || !('geolocation' in navigator)) {
      return Promise.resolve({
        lat: 0,
        lng: 0,
        accuracyMeters: 999,
        gpsLocked: false,
      });
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
            gpsLocked: true,
          });
        },
        () =>
          resolve({ lat: 0, lng: 0, accuracyMeters: 999, gpsLocked: false }),
        { maximumAge: 60_000, timeout: 5000 }
      );
    });
  }

  async getConnectivitySnapshot(): Promise<TelemetryPayload['connectivity']> {
    if (!this.isCapacitorNative()) {
      return this.browserConnectivityFallback();
    }
    try {
      const status = await Network.getStatus();
      if (!status.connected) {
        return { networkType: 'none', signalStrengthDbm: null };
      }
      const t = status.connectionType;
      if (t === 'wifi') {
        let rssi: number | null = null;
        try {
          const { rssi: r } = await CapacitorWifi.getRssi();
          rssi = r;
        } catch {
          /* ignore */
        }
        return { networkType: 'WiFi', signalStrengthDbm: rssi };
      }
      if (t === 'cellular') {
        return { networkType: '4G', signalStrengthDbm: null };
      }
      return { networkType: 'WiFi', signalStrengthDbm: null };
    } catch {
      return this.browserConnectivityFallback();
    }
  }

  private browserConnectivityFallback(): TelemetryPayload['connectivity'] {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const online = nav?.onLine ?? true;
    if (!online) {
      return { networkType: 'none', signalStrengthDbm: null };
    }
    const conn = (
      nav as { connection?: { effectiveType?: string; type?: string } }
    )?.connection;
    const s = conn?.effectiveType ?? conn?.type ?? '';
    if (/wifi/i.test(String(s))) {
      return { networkType: 'WiFi', signalStrengthDbm: null };
    }
    if (/5g/i.test(String(s))) {
      return { networkType: '5G', signalStrengthDbm: null };
    }
    if (/4g|lte/i.test(String(s))) {
      return { networkType: '4G', signalStrengthDbm: null };
    }
    return { networkType: 'WiFi', signalStrengthDbm: null };
  }

  async buildNativeExtras(): Promise<TelemetryPayload['nativeExtras']> {
    if (!this.isCapacitorNative()) {
      return undefined;
    }
    const out: NonNullable<TelemetryPayload['nativeExtras']> = {
      privacyScreenWhenBackgrounded: this.privacyWhenBackgrounded,
      keepAwakeEnabled: this.keepAwakeEnabled,
    };

    try {
      const { isInKioskMode } = await CapacitorAndroidKiosk.isInKioskMode();
      out.kioskModeActive = isInKioskMode;
    } catch {
      /* ignore */
    }

    if (this.latestAccel) {
      out.accelerometer = { ...this.latestAccel };
    }

    try {
      const { value } = await CapgoCompass.getCurrentHeading();
      out.compassHeadingDeg = value;
    } catch {
      /* ignore */
    }

    if (this.latestLux !== null) {
      out.ambientLightLux = this.latestLux;
    }

    try {
      const { ssid } = await CapacitorWifi.getSsid();
      if (ssid) {
        out.wifiSsid = ssid;
      }
    } catch {
      /* ignore */
    }

    try {
      const status = await Network.getStatus();
      if (status.connected && status.connectionType === 'wifi') {
        const { rssi } = await CapacitorWifi.getRssi();
        out.wifiRssiDbm = rssi;
      }
    } catch {
      /* ignore */
    }

    try {
      const avail = await CapgoBrightness.isAvailable();
      if (avail.available) {
        const sys = await CapgoBrightness.getSystemBrightness().catch(() =>
          CapgoBrightness.getBrightness()
        );
        out.screenBrightness = sys.brightness;
      }
    } catch {
      /* ignore */
    }

    try {
      const v = await VolumeControl.getVolumeLevel({
        type: VolumeType.MUSIC,
      });
      out.volumePercent = Math.round((v.value ?? 0) * 100);
    } catch {
      /* ignore */
    }

    return out;
  }
}
