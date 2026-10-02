package com.openad;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "OpenAdMainActivity";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PowerStatePlugin.class);
    registerPlugin(OpenAdSilentInstallPlugin.class);
    configureLockTaskAllowlistIfDeviceOwner();
    super.onCreate(savedInstanceState);
  }

  /**
   * If this app is the Device Owner, allowlist it for Lock Task so kiosk mode can be entered
   * without user confirmation.
   */
  private void configureLockTaskAllowlistIfDeviceOwner() {
    try {
      DevicePolicyManager dpm =
          (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
      if (dpm == null) return;
      if (!dpm.isDeviceOwnerApp(getPackageName())) {
        return;
      }
      ComponentName admin = new ComponentName(this, OpenAdDeviceAdminReceiver.class);
      dpm.setLockTaskPackages(admin, new String[] {getPackageName()});
      // Most restrictive: no system UI features while locked.
      dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
      Log.i(TAG, "Configured lock task allowlist for device owner");
    } catch (SecurityException se) {
      Log.w(TAG, "Failed to configure lock task (security)", se);
    } catch (Exception e) {
      Log.w(TAG, "Failed to configure lock task", e);
    }
  }
}
