package com.openad;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Emits `powerStateChange` when external power is connected/disconnected.
 *
 * JS expects a plugin named "PowerState" that supports addListener('powerStateChange', ...).
 * Capacitor provides addListener; this plugin only needs to call notifyListeners(...).
 */
@CapacitorPlugin(name = "PowerState")
public class PowerStatePlugin extends Plugin {
  private BroadcastReceiver receiver;
  private Boolean lastConnected = null;

  @Override
  public void load() {
    super.load();

    receiver =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) {
              return;
            }

            String action = intent.getAction();
            boolean connected;
            if (Intent.ACTION_POWER_CONNECTED.equals(action)) {
              connected = true;
            } else if (Intent.ACTION_POWER_DISCONNECTED.equals(action)) {
              connected = false;
            } else {
              return;
            }

            // De-dupe in case OEMs spam duplicates.
            if (lastConnected != null && lastConnected == connected) {
              return;
            }
            lastConnected = connected;

            JSObject payload = new JSObject();
            payload.put("connected", connected);

            Integer pct = readBatteryPercent(context);
            if (pct != null) {
              payload.put("batteryPercent", pct);
            }

            notifyListeners("powerStateChange", payload);
          }
        };

    IntentFilter filter = new IntentFilter();
    filter.addAction(Intent.ACTION_POWER_CONNECTED);
    filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
    getContext().registerReceiver(receiver, filter);

    // Emit an initial best-effort state so the web layer can initialize.
    Boolean initial = readIsPlugged(getContext());
    if (initial != null) {
      lastConnected = initial;
      JSObject payload = new JSObject();
      payload.put("connected", initial);
      Integer pct = readBatteryPercent(getContext());
      if (pct != null) {
        payload.put("batteryPercent", pct);
      }
      notifyListeners("powerStateChange", payload, true);
    }
  }

  @Override
  protected void handleOnDestroy() {
    if (receiver != null) {
      try {
        getContext().unregisterReceiver(receiver);
      } catch (Exception ignored) {
        // no-op
      }
      receiver = null;
    }
    super.handleOnDestroy();
  }

  @Nullable
  private static Integer readBatteryPercent(Context ctx) {
    try {
      BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
      if (bm == null) return null;
      int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
      return pct >= 0 && pct <= 100 ? pct : null;
    } catch (Exception e) {
      return null;
    }
  }

  @Nullable
  private static Boolean readIsPlugged(Context ctx) {
    try {
      Intent batteryStatus =
          ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      if (batteryStatus == null) return null;
      int plugged = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
      return plugged != 0;
    } catch (Exception e) {
      return null;
    }
  }
}

