package com.openad

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity

/**
 * Activity única do player. Registra os plugins nativos próprios e, quando o aplicativo é
 * Device Owner, prepara o Lock Task para o modo quiosque.
 */
class MainActivity : BridgeActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(PowerStatePlugin::class.java)
    registerPlugin(OpenAdSilentInstallPlugin::class.java)
    configurarLockTaskSeDeviceOwner()
    super.onCreate(savedInstanceState)
  }

  /**
   * Coloca o próprio pacote na allowlist de Lock Task, para que o quiosque seja ativado sem
   * confirmação do usuário. Só faz sentido quando o aplicativo é Device Owner.
   */
  private fun configurarLockTaskSeDeviceOwner() {
    try {
      val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
      if (!dpm.isDeviceOwnerApp(packageName)) {
        return
      }

      val admin = ComponentName(this, OpenAdDeviceAdminReceiver::class.java)
      dpm.setLockTaskPackages(admin, arrayOf(packageName))

      // setLockTaskFeatures só existe a partir da API 28, e o minSdk do projeto é 24.
      // Chamar sem guarda lança NoSuchMethodError, que é Error e não Exception — ou seja,
      // não seria contido pelos catch abaixo e derrubaria o boot em Android 7 e 8.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        // Mais restritivo possível: nenhuma interface do sistema enquanto travado.
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
      } else {
        Log.i(TAG, "setLockTaskFeatures indisponível nesta API; mantendo o padrão do sistema")
      }

      Log.i(TAG, "Allowlist de Lock Task configurada para o Device Owner")
    } catch (e: SecurityException) {
      Log.w(TAG, "Falha ao configurar o Lock Task (segurança)", e)
    } catch (e: Exception) {
      Log.w(TAG, "Falha ao configurar o Lock Task", e)
    }
  }

  private companion object {
    const val TAG = "OpenAdMainActivity"
  }
}
