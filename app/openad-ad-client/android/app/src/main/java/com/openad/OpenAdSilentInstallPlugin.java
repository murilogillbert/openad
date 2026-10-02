package com.openad;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Silent in-app update via {@link PackageInstaller} session (same-package upgrade).
 * Intended for Device Owner / kiosk tablets; requires matching signature with the installed APK.
 */
@CapacitorPlugin(name = "OpenAdSilentInstall")
public class OpenAdSilentInstallPlugin extends Plugin {

  private static final String TAG = "OpenAdSilentInstall";
  private static final String INSTALL_ACTION = "com.openad.PACKAGE_INSTALL_COMMIT";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final ConcurrentHashMap<Integer, PluginCall> pendingBySession = new ConcurrentHashMap<>();

  @PluginMethod
  public void installApkFromCache(PluginCall call) {
    String filename = call.getString("filename");
    if (filename == null || filename.isEmpty()) {
      call.reject("filename is required");
      return;
    }
    if (filename.contains("..") || filename.contains(File.separator)) {
      call.reject("invalid filename");
      return;
    }

    Context ctx = getContext();
    File cacheDir = ctx.getCacheDir();
    File apk = new File(cacheDir, filename);
    if (!apk.isFile() || !apk.getCanonicalPath().startsWith(cacheDir.getCanonicalPath())) {
      call.reject("apk not found or path escape");
      return;
    }

    executor.execute(
        () -> {
          try {
            runSessionInstall(ctx, apk, call);
          } catch (Exception e) {
            Log.e(TAG, "install failed", e);
            String msg = e.getMessage() != null ? e.getMessage() : "install_failed";
            rejectOnMainThread(call, msg);
          }
        });
  }

  private void rejectOnMainThread(PluginCall call, String message) {
    new Handler(Looper.getMainLooper()).post(() -> call.reject(message));
  }

  private void resolveOnMainThread(PluginCall call, JSObject data) {
    new Handler(Looper.getMainLooper()).post(() -> call.resolve(data));
  }

  private void runSessionInstall(@NonNull Context ctx, @NonNull File apk, @NonNull PluginCall call)
      throws Exception {
    PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams params =
        new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
    params.setSize(apk.length());

    int sessionId = installer.createSession(params);
    pendingBySession.put(sessionId, call);

    PackageInstaller.Session session = null;
    try {
      session = installer.openSession(sessionId);

      try (OutputStream out = session.openWrite("package", 0, -1);
          FileInputStream in = new FileInputStream(apk)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
          out.write(buf, 0, n);
        }
        session.fsync(out);
      }

      String action = INSTALL_ACTION + "." + sessionId;
      Intent callback = new Intent(action).setPackage(ctx.getPackageName());
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags |= PendingIntent.FLAG_MUTABLE;
      }
      PendingIntent pending =
          PendingIntent.getBroadcast(ctx, sessionId, callback, flags);

      BroadcastReceiver receiver =
          new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
              int status =
                  intent.getIntExtra(
                      PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
              int sid =
                  intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
              String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
              Log.i(TAG, "install commit status=" + status + " session=" + sid + " msg=" + msg);

              PluginCall pc = pendingBySession.remove(sid);
              try {
                c.unregisterReceiver(this);
              } catch (Exception ignored) {
              }

              if (pc == null) {
                return;
              }
              if (status == PackageInstaller.STATUS_SUCCESS) {
                JSObject ret = new JSObject();
                ret.put("sessionId", sid);
                OpenAdSilentInstallPlugin.this.resolveOnMainThread(pc, ret);
              } else if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                OpenAdSilentInstallPlugin.this.rejectOnMainThread(pc, "pending_user_action");
              } else {
                OpenAdSilentInstallPlugin.this.rejectOnMainThread(
                    pc, msg != null ? msg : ("install_status_" + status));
              }
            }
          };

      IntentFilter filter = new IntentFilter(action);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.registerReceiver(
            ctx, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
      } else {
        ctx.registerReceiver(receiver, filter);
      }

      session.commit(pending.getIntentSender());
    } catch (Exception e) {
      pendingBySession.remove(sessionId);
      try {
        if (session != null) {
          session.abandon();
        } else {
          installer.abandonSession(sessionId);
        }
      } catch (Exception ignored) {
      }
      throw e;
    }
  }

  @Override
  protected void handleOnDestroy() {
    executor.shutdownNow();
    super.handleOnDestroy();
  }
}
