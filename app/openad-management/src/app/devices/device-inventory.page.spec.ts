import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import type { DeviceInventoryItem, Paginated } from '@openad/api-contracts';
import { DeviceInventoryPage } from './device-inventory.page';
import { InventoryService } from '../inventory/inventory.service';

describe('DeviceInventoryPage', () => {
  let fixture: ComponentFixture<DeviceInventoryPage>;
  let inventory: {
    listDevices: () => ReturnType<InventoryService['listDevices']>;
  };

  beforeEach(async () => {
    const empty: Paginated<DeviceInventoryItem> = {
      data: [],
      pagination: { total: 0, page: 1, limit: 500 },
    };
    inventory = {
      listDevices: () => of(empty),
    };
    await TestBed.configureTestingModule({
      imports: [DeviceInventoryPage, RouterTestingModule],
      providers: [{ provide: InventoryService, useValue: inventory }],
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
