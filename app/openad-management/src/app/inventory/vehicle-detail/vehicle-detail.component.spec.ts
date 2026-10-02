import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { VehicleBindingAuditListResponse, VehicleListItem } from '@openad/api-contracts';
import { ConfirmationService, MessageService } from 'primeng/api';
import { InventoryService } from '../inventory.service';
import { VehicleDetailComponent } from './vehicle-detail.component';

describe('VehicleDetailComponent', () => {
  let fixture: ComponentFixture<VehicleDetailComponent>;
  let listBindingAuditCalls: Array<{ vehicleId: string; query: { limit?: number } }>;

  const baseVehicle: VehicleListItem = {
    vehicleId: '11111111-1111-1111-1111-111111111111',
    registrationPlate: 'TEST-1',
    make: 'Acme',
    model: 'Van',
    status: 'active',
    pairedDeviceIds: [],
    bindingStatus: 'hardware_offline',
    inShop: false,
    boundDevice: null,
  };

  beforeEach(async () => {
    const audit: VehicleBindingAuditListResponse = {
      items: [
        {
          eventId: 'e1',
          action: 'pair',
          vehicleId: baseVehicle.vehicleId,
          deviceId: '22222222-2222-2222-2222-222222222222',
          actorUserId: 'u1',
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    };
    listBindingAuditCalls = [];
    const inventoryStub = {
      listBindingAudit: (
        vehicleId: string,
        query: { limit?: number; cursor?: string; deviceId?: string } = {}
      ) => {
        listBindingAuditCalls.push({ vehicleId, query });
        return of(audit);
      },
    };

    await TestBed.configureTestingModule({
      imports: [VehicleDetailComponent],
      providers: [
        {
          provide: InventoryService,
          useValue: inventoryStub,
        },
        { provide: ConfirmationService, useValue: { confirm: (): void => undefined } },
        { provide: MessageService, useValue: { add: (): void => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VehicleDetailComponent);
  });

  it('shows binding audit section when events exist', async () => {
    fixture.componentRef.setInput('vehicle', baseVehicle);
    fixture.detectChanges();
    await fixture.whenStable();

    const auditRoot = fixture.nativeElement.querySelector(
      '[data-testid="vehicle-binding-audit"]'
    );
    expect(auditRoot).toBeTruthy();
    expect(auditRoot?.textContent).toMatch(/Binding history/);
    expect(auditRoot?.textContent).toMatch(/Pair/);
    expect(listBindingAuditCalls).toEqual([
      { vehicleId: baseVehicle.vehicleId, query: { limit: 50 } },
    ]);
  });
});
