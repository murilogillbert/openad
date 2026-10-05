import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import {
  DriversService,
  type DeviceDriverBinding,
  type DriverSummary,
} from './drivers.service';

/**
 * Vincula um motorista do cadastro do ecossistema ao tablete.
 *
 * Mostra nome e e-mail porque é o que o operador reconhece — o `userId` é um UUID que não
 * diz nada a ninguém. Antes desta tela o vínculo era digitar aquele UUID num campo de
 * veículo, validado só pelo formato: um dígito trocado mandava o repasse para um
 * identificador inexistente sem erro algum, porque a chamada de crédito não lança exceção.
 *
 * A porcentagem aparece junto do resultado de propósito. Vincular motorista é decidir quem
 * recebe dinheiro, e quanto; esconder o quanto atrás de outra tela separa a decisão da sua
 * consequência.
 */
@Component({
  selector: 'app-device-driver-dialog',
  standalone: true,
  imports: [
    CommonModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    TagModule,
  ],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [draggable]="false"
      header="Motorista do aparelho"
    >
      @if (serialNumber(); as serie) {
        <p class="mb-3 text-sm text-surface-500">Aparelho {{ serie }}</p>
      }

      @if (erro(); as e) {
        <div
          class="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {{ e }}
        </div>
      }

      @if (vinculo(); as v) {
        <div class="mb-4 rounded border border-surface-200 p-3">
          <div class="text-xs uppercase text-surface-500">Vinculado agora</div>
          @if (v.driver; as d) {
            <div class="mt-1 font-medium">{{ d.name }}</div>
            <div class="text-sm text-surface-600">{{ d.email }}</div>
            <div class="mt-2 text-sm">
              Repasse combinado:
              <strong>{{ v.payoutMinPercent * 100 | number: '1.0-1' }}%</strong>
              do valor faturável de cada veiculação
            </div>
            <p-button
              label="Desvincular"
              severity="danger"
              [text]="true"
              size="small"
              [disabled]="ocupado()"
              (onClick)="desvincular()"
            />
          } @else {
            <div class="mt-1 text-sm text-surface-600">
              Nenhum motorista. A veiculação continua sendo faturada, mas o
              repasse não tem a quem ser pago.
            </div>
          }
        </div>
      }

      <label class="mb-1 block text-sm font-medium" for="busca-motorista">
        Pesquisar por nome ou e-mail
      </label>
      <input
        id="busca-motorista"
        pInputText
        class="w-full"
        type="search"
        autocomplete="off"
        [value]="termo()"
        (input)="onTermo($event)"
      />

      <div class="mt-3 max-h-64 overflow-y-auto">
        @if (buscando()) {
          <div class="p-2 text-sm text-surface-500">Pesquisando…</div>
        } @else if (resultados().length === 0) {
          <div class="p-2 text-sm text-surface-500">
            Nenhum motorista encontrado.
          </div>
        } @else {
          <ul class="divide-y divide-surface-200">
            @for (d of resultados(); track d.userId) {
              <li class="flex items-center justify-between gap-2 py-2">
                <div class="min-w-0">
                  <div class="truncate font-medium">{{ d.name }}</div>
                  <div class="truncate text-sm text-surface-600">
                    {{ d.email }}
                  </div>
                </div>
                <p-button
                  label="Vincular"
                  size="small"
                  [disabled]="ocupado() || d.userId === atualId()"
                  (onClick)="vincular(d)"
                />
              </li>
            }
          </ul>
        }
      </div>
    </p-dialog>
  `,
})
export class DeviceDriverDialogComponent {
  private readonly drivers = inject(DriversService);

  readonly visible = input(false);
  readonly deviceId = input<string | null>(null);
  readonly serialNumber = input<string | null>(null);

  readonly visibleChange = output<boolean>();
  readonly changed = output<void>();

  protected readonly vinculo = signal<DeviceDriverBinding | null>(null);
  protected readonly resultados = signal<DriverSummary[]>([]);
  protected readonly termo = signal('');
  protected readonly buscando = signal(false);
  protected readonly ocupado = signal(false);
  protected readonly erro = signal<string | null>(null);

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.deviceId();
      if (!this.visible() || !id) {
        return;
      }
      this.erro.set(null);
      this.termo.set('');
      this.carregar(id);
      this.pesquisar('');
    });
  }

  protected atualId(): string | null {
    return this.vinculo()?.driver?.userId ?? null;
  }

  protected onTermo(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.termo.set(v);
    // Debounce: o `contains` roda em `public.users`, que é a tabela do hub inteiro.
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.pesquisar(v);
    }, 300);
  }

  private carregar(deviceId: string): void {
    this.drivers.get(deviceId).subscribe({
      next: (v) => this.vinculo.set(v),
      error: (e: HttpErrorResponse) => {
        this.vinculo.set(null);
        this.erro.set(this.mensagem(e));
      },
    });
  }

  private pesquisar(q: string): void {
    this.buscando.set(true);
    this.drivers.search(q).subscribe({
      next: (r) => {
        this.resultados.set(r);
        this.buscando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.resultados.set([]);
        this.buscando.set(false);
        this.erro.set(this.mensagem(e));
      },
    });
  }

  protected vincular(d: DriverSummary): void {
    const id = this.deviceId();
    if (!id) {
      return;
    }
    this.ocupado.set(true);
    this.erro.set(null);
    this.drivers.bind(id, d.userId).subscribe({
      next: (v) => {
        this.vinculo.set(v);
        this.ocupado.set(false);
        this.changed.emit();
      },
      error: (e: HttpErrorResponse) => {
        this.ocupado.set(false);
        this.erro.set(this.mensagem(e));
      },
    });
  }

  protected desvincular(): void {
    const id = this.deviceId();
    if (!id) {
      return;
    }
    this.ocupado.set(true);
    this.erro.set(null);
    this.drivers.unbind(id).subscribe({
      next: (v) => {
        this.vinculo.set(v);
        this.ocupado.set(false);
        this.changed.emit();
      },
      error: (e: HttpErrorResponse) => {
        this.ocupado.set(false);
        this.erro.set(this.mensagem(e));
      },
    });
  }

  /**
   * Traduz a falha em próximo passo.
   *
   * `DEVICE_WITHOUT_VEHICLE` é o caso que mais acontece e o menos óbvio: o vínculo é
   * guardado no veículo, então um tablete sem veículo não tem onde guardar o motorista.
   */
  private mensagem(e: HttpErrorResponse): string {
    const codigo = e.error?.error?.code ?? e.error?.code;
    if (codigo === 'DEVICE_WITHOUT_VEHICLE') {
      return 'Aparelho não está pareado a um veículo. Cadastre o veículo e pareie o aparelho antes de vincular o motorista.';
    }
    if (codigo === 'DRIVER_NOT_FOUND') {
      return 'Motorista não encontrado no cadastro do ecossistema.';
    }
    if (e.status === 0) {
      return 'Não foi possível falar com a API. Verifique a conexão.';
    }
    if (e.status === 403) {
      return 'Sem permissão. Exige fleet_operator, fleet_admin ou super_admin.';
    }
    const detalhe = e.error?.error?.message ?? e.error?.message;
    return detalhe ?? `Falha na operação (HTTP ${e.status}).`;
  }
}
