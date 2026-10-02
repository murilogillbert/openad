package com.openad;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Device Admin receiver used for Device Owner (DPC) provisioning.
 *
 * After this receiver exists in the manifest, you can provision a factory-reset device with:
 *   adb shell dpm set-device-owner com.openad/.OpenAdDeviceAdminReceiver
 */
public class OpenAdDeviceAdminReceiver extends DeviceAdminReceiver {
  private static final String TAG = "OpenAdDeviceAdmin";

  @Override
  public void onEnabled(Context context, Intent intent) {
    Log.i(TAG, "Device admin enabled");
  }

  @Override
  public void onDisabled(Context context, Intent intent) {
    Log.i(TAG, "Device admin disabled");
  }
}

