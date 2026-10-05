package com.openad

import android.app.ActivityManager
import android.content.Context
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

  @PluginMethod
  fun state(call: PluginCall) {
    val retorno = JSObject()
    try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val estado = am?.lockTaskModeState ?: ActivityManager.LOCK_TASK_MODE_NONE
      retorno.put(
        "mode",
        when (estado) {
          ActivityManager.LOCK_TASK_MODE_LOCKED -> "locked"
          ActivityManager.LOCK_TASK_MODE_PINNED -> "pinned"
          else -> "none"
        },
      )
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
}
