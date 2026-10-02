package com.openad

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Autoatualização silenciosa por sessão do [PackageInstaller] (upgrade do mesmo pacote).
 *
 * Destinado a tablets em quiosque / Device Owner; exige que o APK novo tenha a mesma
 * assinatura do instalado.
 */
@CapacitorPlugin(name = "OpenAdSilentInstall")
class OpenAdSilentInstallPlugin : Plugin() {

  private val executor = Executors.newSingleThreadExecutor()
  private val pendingBySession = ConcurrentHashMap<Int, PluginCall>()

  @PluginMethod
  fun installApkFromCache(call: PluginCall) {
    val filename = call.getString("filename")
    if (filename.isNullOrEmpty()) {
      call.reject("filename is required")
      return
    }
    if (filename.contains("..") || filename.contains(File.separator)) {
      call.reject("invalid filename")
      return
    }

    val ctx = context
    val cacheDir = ctx.cacheDir
    val apk = File(cacheDir, filename)

    // getCanonicalPath lança IOException. No código Java original a chamada estava fora de
    // qualquer try e o método não declarava throws, então aquele arquivo não compilava.
    val dentroDoCache =
      try {
        apk.isFile && apk.canonicalPath.startsWith(cacheDir.canonicalPath)
      } catch (e: IOException) {
        Log.w(TAG, "Falha ao resolver o caminho canônico do APK", e)
        false
      }
    if (!dentroDoCache) {
      call.reject("apk not found or path escape")
      return
    }

    executor.execute {
      try {
        runSessionInstall(ctx, apk, call)
      } catch (e: Exception) {
        Log.e(TAG, "install failed", e)
        rejectOnMainThread(call, e.message ?: "install_failed")
      }
    }
  }

  private fun rejectOnMainThread(call: PluginCall, message: String) {
    Handler(Looper.getMainLooper()).post { call.reject(message) }
  }

  private fun resolveOnMainThread(call: PluginCall, data: JSObject) {
    Handler(Looper.getMainLooper()).post { call.resolve(data) }
  }

  private fun runSessionInstall(ctx: Context, apk: File, call: PluginCall) {
    val installer = ctx.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setSize(apk.length())

    val sessionId = installer.createSession(params)
    pendingBySession[sessionId] = call

    var sessionAberta: PackageInstaller.Session? = null
    try {
      val session = installer.openSession(sessionId)
      sessionAberta = session

      session.openWrite("package", 0, -1).use { out ->
        apk.inputStream().use { entrada -> entrada.copyTo(out, TAMANHO_DO_BUFFER) }
        session.fsync(out)
      }

      val action = "$INSTALL_ACTION.$sessionId"
      val callback = Intent(action).setPackage(ctx.packageName)
      var flags = PendingIntent.FLAG_UPDATE_CURRENT
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags = flags or PendingIntent.FLAG_MUTABLE
      }
      val pending = PendingIntent.getBroadcast(ctx, sessionId, callback, flags)

      val receiver =
        object : BroadcastReceiver() {
          override fun onReceive(contextDoReceiver: Context, intent: Intent) {
            val status =
              intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            val sid = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
            val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
            Log.i(TAG, "install commit status=$status session=$sid msg=$msg")

            val chamadaPendente = pendingBySession.remove(sid)
            try {
              contextDoReceiver.unregisterReceiver(this)
            } catch (e: IllegalArgumentException) {
              Log.d(TAG, "receiver já removido", e)
            }

            if (chamadaPendente == null) {
              return
            }
            when (status) {
              PackageInstaller.STATUS_SUCCESS -> {
                val retorno = JSObject()
                retorno.put("sessionId", sid)
                resolveOnMainThread(chamadaPendente, retorno)
              }
              PackageInstaller.STATUS_PENDING_USER_ACTION ->
                rejectOnMainThread(chamadaPendente, "pending_user_action")
              else -> rejectOnMainThread(chamadaPendente, msg ?: "install_status_$status")
            }
          }
        }

      // ContextCompat aplica RECEIVER_NOT_EXPORTED a partir da API 33 e ignora o flag abaixo
      // dela, o que dispensa o desvio por versão que existia no código Java.
      ContextCompat.registerReceiver(
        ctx,
        receiver,
        IntentFilter(action),
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )

      session.commit(pending.intentSender)
    } catch (e: Exception) {
      pendingBySession.remove(sessionId)
      try {
        if (sessionAberta != null) {
          sessionAberta.abandon()
        } else {
          installer.abandonSession(sessionId)
        }
      } catch (erroAoAbandonar: Exception) {
        Log.d(TAG, "falha ao abandonar a sessão $sessionId", erroAoAbandonar)
      }
      throw e
    }
  }

  protected override fun handleOnDestroy() {
    executor.shutdownNow()
    super.handleOnDestroy()
  }

  private companion object {
    const val TAG = "OpenAdSilentInstall"
    const val INSTALL_ACTION = "com.openad.PACKAGE_INSTALL_COMMIT"
    const val TAMANHO_DO_BUFFER = 64 * 1024
  }
}
