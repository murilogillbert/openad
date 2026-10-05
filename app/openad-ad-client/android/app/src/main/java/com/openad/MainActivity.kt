package com.openad

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import com.getcapacitor.BridgeActivity

/**
 * Activity única do player. Registra os plugins nativos próprios e, quando o aplicativo é
 * Device Owner, prepara o Lock Task para o modo quiosque.
 */
class MainActivity : BridgeActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(PowerStatePlugin::class.java)
    registerPlugin(OpenAdSilentInstallPlugin::class.java)
    registerPlugin(OpenAdVolumeKeyPlugin::class.java)
    registerPlugin(OpenAdKioskStatePlugin::class.java)
    configurarLockTaskSeDeviceOwner()
    super.onCreate(savedInstanceState)
  }

  /**
   * Intercepta o volume para baixo e repassa ao lado web, consumindo a tecla.
   *
   * Duas razoes para consumir em vez de deixar passar com `super`:
   *
   * 1. O tablete em quiosque nao deve responder a controle nenhum. Lock Task bloqueia home,
   *    recentes e barra de status, mas **nao** bloqueia as teclas de volume — elas continuam
   *    chegando e mudando o volume do sistema.
   * 2. Esta tecla e metade do gesto que libera o aparelho (a outra metade e toque mantido na
   *    tela). Mudar o volume ao mesmo tempo seria efeito colateral visivel de um gesto que
   *    deve ser discreto.
   *
   * `repeatCount == 0` filtra a repeticao automatica de tecla mantida: o lado web precisa de
   * uma borda de descida, nao de dezenas de eventos por segundo. O volume para **cima**
   * continua no caminho padrao de proposito — e a saida de quem precisa provar que o
   * aparelho responde, sem destravar nada.
   */
  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      if (event.repeatCount == 0) {
        OpenAdVolumeKeyPlugin.instancia?.emitir(true)
      }
      return true
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      OpenAdVolumeKeyPlugin.instancia?.emitir(false)
      return true
    }
    return super.onKeyUp(keyCode, event)
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
