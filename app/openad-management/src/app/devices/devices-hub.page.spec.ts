import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DevicesHubPage } from './devices-hub.page';

describe('DevicesHubPage', () => {
  let fixture: ComponentFixture<DevicesHubPage>;

  beforeEach(async () => {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
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
