package com.openad

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Repassa o botao de volume para baixo ao lado web.
 *
 * Existe porque a WebView **nao recebe** evento de tecla de volume no JavaScript: o sistema
 * entrega essas teclas a Activity, e elas nao chegam ao DOM nem como `keydown`. Sem esta
 * ponte o gesto de destravamento do quiosque (toque mantido na tela junto com volume para
 * baixo) nao tem como ser detectado em Angular.
 *
 * A Activity consome a tecla, entao o volume do aparelho **nao muda**. Isso e proposito, nao
 * efeito colateral: o tablete em quiosque nao deve responder a nenhum controle, e o volume e
 * justamente a metade do gesto que libera o aparelho.
 *
 * `instancia` e estatica porque quem recebe o evento e a [MainActivity], nao o plugin, e
 * `bridge.getPlugin(...)` exigiria a Activity conhecer o nome registrado e lidar com o
 * instante entre `onCreate` e o carregamento da ponte. `@Volatile` porque a escrita acontece
 * no carregamento do plugin e a leitura na thread de eventos de entrada.
 */
@CapacitorPlugin(name = "OpenAdVolumeKey")
class OpenAdVolumeKeyPlugin : Plugin() {

  override fun load() {
    super.load()
    instancia = this
  }

  protected override fun handleOnDestroy() {
    if (instancia === this) {
      instancia = null
    }
    super.handleOnDestroy()
  }

  /** Emite `volumeDown` com `pressed` indicando se a tecla esta pressionada. */
  fun emitir(pressionado: Boolean) {
    val payload = JSObject()
    payload.put("pressed", pressionado)
    notifyListeners("volumeDown", payload)
  }

  companion object {
    @Volatile
    @JvmStatic
    var instancia: OpenAdVolumeKeyPlugin? = null
  }
}
