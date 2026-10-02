package com.openad

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Emite `powerStateChange` quando a alimentação externa é conectada ou desconectada, que é como
 * o player infere motor ligado e motor desligado.
 *
 * O lado JS espera um plugin chamado "PowerState" com addListener('powerStateChange', ...).
 * O addListener vem do Capacitor; aqui basta chamar notifyListeners.
 */
@CapacitorPlugin(name = "PowerState")
class PowerStatePlugin : Plugin() {

  private var receiver: BroadcastReceiver? = null
  private var lastConnected: Boolean? = null

  override fun load() {
    super.load()

    val novoReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(contextDoReceiver: Context, intent: Intent) {
          val connected =
            when (intent.action) {
              Intent.ACTION_POWER_CONNECTED -> true
              Intent.ACTION_POWER_DISCONNECTED -> false
              else -> return
            }

          // Alguns fabricantes repetem o mesmo broadcast; ignora a repetição.
          if (lastConnected == connected) {
            return
          }
          lastConnected = connected

          notifyListeners("powerStateChange", montarPayload(contextDoReceiver, connected))
        }
      }
    receiver = novoReceiver

    val filtro =
      IntentFilter().apply {
        addAction(Intent.ACTION_POWER_CONNECTED)
        addAction(Intent.ACTION_POWER_DISCONNECTED)
      }
    // Só o sistema emite estes broadcasts, então o receiver não precisa ser exportado.
    // Declarar o flag é exigência para targetSdk 34 ou maior, e o projeto está em 36.
    ContextCompat.registerReceiver(
      context,
      novoReceiver,
      filtro,
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )

    // Emite um estado inicial, em melhor esforço, para o lado web conseguir inicializar.
    val estadoInicial = readIsPlugged(context)
    if (estadoInicial != null) {
      lastConnected = estadoInicial
      notifyListeners("powerStateChange", montarPayload(context, estadoInicial), true)
    }
  }

  private fun montarPayload(ctx: Context, connected: Boolean): JSObject {
    val payload = JSObject()
    payload.put("connected", connected)
    readBatteryPercent(ctx)?.let { percentual -> payload.put("batteryPercent", percentual) }
    return payload
  }

  protected override fun handleOnDestroy() {
    receiver?.let { atual ->
      try {
        context.unregisterReceiver(atual)
      } catch (e: IllegalArgumentException) {
        Log.d(TAG, "receiver de energia já removido", e)
      }
    }
    receiver = null
    super.handleOnDestroy()
  }

  private companion object {
    const val TAG = "OpenAdPowerState"

    private fun readBatteryPercent(ctx: Context): Int? {
      return try {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        val percentual = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (percentual in 0..100) percentual else null
      } catch (e: Exception) {
        Log.d(TAG, "falha ao ler o percentual de bateria", e)
        null
      }
    }

    private fun readIsPlugged(ctx: Context): Boolean? {
      return try {
        val status = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (status == null) {
          null
        } else {
          status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        }
      } catch (e: Exception) {
        Log.d(TAG, "falha ao ler o estado de alimentação", e)
        null
      }
    }
  }
}
