package com.openad

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receiver de Device Admin usado no provisionamento como Device Owner (DPC).
 *
 * Com este receiver declarado no manifesto, um tablet recém-formatado pode ser provisionado com:
 *   adb shell dpm set-device-owner com.openad/.OpenAdDeviceAdminReceiver
 */
class OpenAdDeviceAdminReceiver : DeviceAdminReceiver() {

  override fun onEnabled(context: Context, intent: Intent) {
    Log.i(TAG, "Device admin habilitado")
  }

  override fun onDisabled(context: Context, intent: Intent) {
    Log.i(TAG, "Device admin desabilitado")
  }

  private companion object {
    const val TAG = "OpenAdDeviceAdmin"
  }
}
