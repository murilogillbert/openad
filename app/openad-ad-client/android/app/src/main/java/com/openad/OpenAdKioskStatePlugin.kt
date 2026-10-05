package com.openad

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Estado **real** do Lock Task, lido do sistema.
 *
 * Existe porque `CapacitorAndroidKiosk.isInKioskMode()` nao e confiavel: ele devolvia `true`
 * enquanto `dumpsys activity activities` reportava `mLockTaskModeState=NONE`. O valor vem de
 * um sinalizador que o proprio plugin mantem quando a chamada de entrada **nao lanca** — e
 * `startLockTask()` sem Device Owner nao lanca, so nao trava.
 *
 * O custo disso nao era so diagnostico: `tablet-native-integration.service.ts` publica esse
 * booleano como `kioskModeActive` na telemetria, e o mapa de frota mostraria a frota inteira
 * como travada em quiosque sem nenhum aparelho estar.
 *
 * `getLockTaskModeState()` e a fonte da verdade, e distingue os dois modos:
 *   NONE (0)    fora de Lock Task
 *   LOCKED (1)  Lock Task de verdade, com allowlist de Device Owner — sem saida pelo usuario
 *   PINNED (2)  fixacao de tela comum, que o usuario pode desfazer segurando voltar+recentes
 */
@CapacitorPlugin(name = "OpenAdKioskState")
class OpenAdKioskStatePlugin : Plugin() {

  /**
   * Entra em Lock Task e **relata o que aconteceu de verdade**.
   *
   * Existe porque `CapacitorAndroidKiosk.enterKioskMode()` resolve sem erro mesmo quando nao
   * trava nada, o que torna impossivel distinguir "travou" de "foi ignorado". Aqui a
   * chamada e feita na thread de UI (exigencia de `startLockTask`) e o estado e lido **de
   * volta do sistema** logo depois, para que a resposta seja observacao e nao suposicao.
   *
   * Sem Device Owner o Android nao permite fixar a tela sem confirmacao do usuario — e
   * decisao de plataforma, nao limitacao de API: se qualquer aplicativo pudesse se fixar
   * sozinho, qualquer aplicativo poderia sequestrar o aparelho. Por isso `mode` costuma
   * voltar `none` com `deviceOwner: false`, e e isso que o chamador precisa saber.
   */
  @PluginMethod
  fun enter(call: PluginCall) {
    val atividade = activity
    if (atividade == null) {
      call.reject("sem activity")
      return
    }
    atividade.runOnUiThread {
      val retorno = JSObject()
      try {
        atividade.startLockTask()
        retorno.put("requested", true)
      } catch (e: Exception) {
        retorno.put("requested", false)
        retorno.put("error", e.message ?: e.javaClass.simpleName)
      }
      // Le o estado de volta: `startLockTask` nao lanca quando e ignorado.
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val estado = am?.lockTaskModeState ?: ActivityManager.LOCK_TASK_MODE_NONE
      retorno.put("mode", nomeDoModo(estado))
      retorno.put("locked", estado == ActivityManager.LOCK_TASK_MODE_LOCKED)
      retorno.put("deviceOwner", ehDeviceOwner())
      call.resolve(retorno)
    }
  }

  @PluginMethod
  fun exit(call: PluginCall) {
    val atividade = activity
    if (atividade == null) {
      call.reject("sem activity")
      return
    }
    atividade.runOnUiThread {
      try {
        atividade.stopLockTask()
      } catch (e: Exception) {
        Log.w(TAG, "stopLockTask falhou", e)
      }
      call.resolve()
    }
  }

  @PluginMethod
  fun state(call: PluginCall) {
    val retorno = JSObject()
    try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val estado = am?.lockTaskModeState ?: ActivityManager.LOCK_TASK_MODE_NONE
      retorno.put("mode", nomeDoModo(estado))
      // `locked` e o unico estado que o usuario nao consegue desfazer sozinho. `pinned` conta
      // como travado para efeito de operacao, mas nao para efeito de garantia.
      retorno.put("locked", estado == ActivityManager.LOCK_TASK_MODE_LOCKED)
      retorno.put("deviceOwner", ehDeviceOwner())
    } catch (e: Exception) {
      retorno.put("mode", "unknown")
      retorno.put("locked", false)
      retorno.put("deviceOwner", false)
      retorno.put("error", e.message ?: "falha ao ler o estado de lock task")
    }
    call.resolve(retorno)
  }

  /**
   * Sem Device Owner nao existe Lock Task sem confirmacao na tela. Reportar isso junto com o
   * estado e o que transforma "o quiosque nao trava" numa resposta em vez de uma suspeita.
   */
  private fun ehDeviceOwner(): Boolean {
    return try {
      val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE)
          as? android.app.admin.DevicePolicyManager
      dpm?.isDeviceOwnerApp(context.packageName) == true
    } catch (e: Exception) {
      false
    }
  }

  private companion object {
    const val TAG = "OpenAdKioskState"

    fun nomeDoModo(estado: Int): String =
      when (estado) {
        ActivityManager.LOCK_TASK_MODE_LOCKED -> "locked"
        ActivityManager.LOCK_TASK_MODE_PINNED -> "pinned"
        else -> "none"
      }
  }
}
