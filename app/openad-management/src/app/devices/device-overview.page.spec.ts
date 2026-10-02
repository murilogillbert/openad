import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { VehicleDetailResponse } from '@openad/api-contracts';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DeviceOverviewPage } from './device-overview.page';
import { DeviceDetailStore } from './device-detail.store';
import { InventoryService } from '../inventory/inventory.service';
import { PortalAuthService } from '../auth/portal-auth.service';

describe('DeviceOverviewPage', () => {
  let fixture: ComponentFixture<DeviceOverviewPage>;

  const mockVehicle: VehicleDetailResponse = {
    vehicleId: 'veh-1',
    registrationPlate: 'ROUTE-1',
    make: 'Make',
    model: 'Model',
    year: 2024,
    status: 'active',
    operatorId: 'op-1',
    commercialTier: 'other',
    pairedDeviceIds: ['device-a', 'device-b'],
    bindingStatus: 'fully_operational',
    driverId: null,
    inShop: false,
    characteristics: { screenCount: 2, passengerCapacity: 4 },
    decommissionedAt: null,
    boundDevice: {
      deviceId: 'device-a',
      serialNumber: 'SN-A',
      lifecycleState: 'Active',
      lastSeenAt: new Date().toISOString(),
      hardwareProfile: {
        screenWidthPx: 1920,
        screenHeightPx: 1080,
        screenSizeInches: 10,
        osVersion: '1',
        storageCapacityGb: 32,
      },
      capabilityManifest: null,
      lastHealthMetrics: null,
      currentRelease: {
        versionIdentifier: '1.0.0',
        installedAt: new Date().toISOString(),
      },
      updateState: {
        lastCheckAt: new Date().toISOString(),
        lastCheckResult: 'up_to_date',
        lastError: null,
      },
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeviceOverviewPage],
      providers: [
        {
          provide: DeviceDetailStore,
          useValue: {
            detail: signal(mockVehicle),
            loading: signal(false),
            error: signal(null),
            load: (): void => undefined,
            replace: (): void => undefined,
          },
        },
        { provide: InventoryService, useValue: {} },
        ConfirmationService,
        MessageService,
        {
          provide: PortalAuthService,
          useValue: { getPortalUser: () => ({ role: 'fleet_operator' }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceOverviewPage);
    fixture.detectChanges();
  });

  it('renders a paired tablets section listing paired device IDs', () => {
    const section = fixture.nativeElement.querySelector(
      '[data-testid="paired-tablets-section"]'
    ) as HTMLElement | null;
    expect(section).toBeTruthy();
    const text = section?.textContent ?? '';
    expect(text).toContain('device-a');
    expect(text).toContain('device-b');
  });
});
