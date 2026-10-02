import { InjectionToken } from '@angular/core';
import {
  PowerStatePlugin,
  type PowerStatePluginContract,
} from '../../capacitor/power-state.plugin';

export const POWER_STATE_PLUGIN = new InjectionToken<PowerStatePluginContract>(
  'POWER_STATE_PLUGIN',
  { factory: () => PowerStatePlugin }
);
