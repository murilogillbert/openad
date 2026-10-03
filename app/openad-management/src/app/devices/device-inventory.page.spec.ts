import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import type { DeviceInventoryItem, Paginated } from '@openad/api-contracts';
import { DeviceInventoryPage } from './device-inventory.page';
import { InventoryService } from '../inventory/inventory.service';

describe('DeviceInventoryPage', () => {
  let fixture: ComponentFixture<DeviceInventoryPage>;
  let inventory: {
    listDevices: () => ReturnType<InventoryService['listDevices']>;
  };
  /** Toasts que a página pediu. Vazio é o esperado no caminho felizmente sem erro. */
  let mensagens: unknown[];

  beforeEach(async () => {
    const empty: Paginated<DeviceInventoryItem> = {
      data: [],
      pagination: { total: 0, page: 1, limit: 500 },
    };
    inventory = {
      listDevices: () => of(empty),
    };
    /**
     * `MessageService` entra por `provide`/`useValue`, e não como `MessageService` real.
     *
     * A página o injeta para mostrar toast de erro. Sem provedor, o `TestBed` lança
     * `NG0201: No provider found for MessageService` **na criação do componente** — a suíte
     * falhava inteira antes de chegar a qualquer `expect`, o que faz o erro parecer um
     * problema da página e não do teste.
     *
     * Um dublê com `add` espionável, em vez da classe real: o toast não tem como ser
     * verificado num teste sem o `p-toast` na árvore, e guardar as mensagens permite afirmar
     * sobre elas quando for preciso.
     */
    mensagens = [];
    await TestBed.configureTestingModule({
      imports: [DeviceInventoryPage, RouterTestingModule],
      providers: [
        { provide: InventoryService, useValue: inventory },
        {
          provide: MessageService,
          useValue: {
            add: (m: unknown) => mensagens.push(m),
            addAll: (ms: unknown[]) => mensagens.push(...ms),
            clear: () => {
              mensagens.length = 0;
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceInventoryPage);
    fixture.detectChanges();
  });

  it('hosts the tablet inventory region and table after load', async () => {
    await fixture.whenStable();
    const root = fixture.nativeElement.querySelector(
      '[data-testid="device-inventory-root"]'
    );
    expect(root).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="device-inventory-table"]')
    ).toBeTruthy();
  });
});
