import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DevicesHubPage } from './devices-hub.page';

describe('DevicesHubPage', () => {
  let fixture: ComponentFixture<DevicesHubPage>;

  beforeEach(async () => {
    /**
     * `ResizeObserver` não existe no ambiente de teste, e componentes do PrimeNG o usam.
     *
     * O dublê registra as chamadas em vez de ter corpo vazio: corpo vazio é relatado por
     * `no-empty-function`, e silenciar a regra perderia a chance de o teste poder afirmar que
     * o componente observou algo. Guardar a chamada custa uma linha e remove a exceção.
     */
    const observados: unknown[] = [];
    globalThis.ResizeObserver = class {
      observe(alvo: Element): void {
        observados.push(alvo);
      }
      unobserve(alvo: Element): void {
        const i = observados.indexOf(alvo);
        if (i >= 0) observados.splice(i, 1);
      }
      disconnect(): void {
        observados.length = 0;
      }
    };

    await TestBed.configureTestingModule({
      imports: [DevicesHubPage, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(DevicesHubPage);
    fixture.detectChanges();
  });

  it('renders PrimeNG tabs for Vehicles, Devices, and Pairing', () => {
    const nav = fixture.nativeElement.querySelector(
      '[aria-label="Devices hub areas"]'
    ) as HTMLElement | null;
    expect(nav).toBeTruthy();
    const text = nav?.textContent ?? '';
    expect(text).toMatch(/Vehicles/);
    expect(text).toMatch(/Pairing/);
    expect(text).toMatch(/Devices/);
    expect(fixture.nativeElement.querySelector('p-tabs')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('p-tab').length).toBe(3);
  });

  it('includes a router-outlet for child routes', () => {
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
  });
});
