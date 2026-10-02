import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { VehicleDetailResponse, VehicleUpdateRequest } from '@openad/api-contracts';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { InventoryService } from '../inventory/inventory.service';
import { DeviceDetailStore } from './device-detail.store';

@Component({
  selector: 'app-device-config',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ProgressSpinnerModule,
    ToastModule,
  ],
  templateUrl: './device-config.page.html',
})
export class DeviceConfigPage {
  protected readonly store = inject(DeviceDetailStore);
  private readonly inventory = inject(InventoryService);
  private readonly message = inject(MessageService);

  protected readonly saving = signal(false);
  private formHydrated = false;

  protected registrationPlate = '';
  protected make = '';
  protected model = '';
  protected year: number | null = null;
  protected commercialTier: VehicleDetailResponse['commercialTier'] = 'other';
  protected screenCount: number | null = null;
  protected passengerCapacity: number | null = null;

  protected readonly fleetOptions: {
    label: string;
    value: VehicleDetailResponse['commercialTier'];
  }[] = [
    { label: 'Premium', value: 'premium' },
    { label: 'Taxi', value: 'taxi' },
    { label: 'Van', value: 'van' },
    { label: 'Other', value: 'other' },
  ];

  constructor() {
    effect(() => {
      const v = this.store.detail();
      if (v && !this.formHydrated) {
        this.registrationPlate = v.registrationPlate;
        this.make = v.make;
        this.model = v.model;
        this.year = v.year;
        this.commercialTier = v.commercialTier;
        this.screenCount = v.characteristics.screenCount;
        this.passengerCapacity = v.characteristics.passengerCapacity;
        this.formHydrated = true;
      }
    });
  }

  protected save(): void {
    const v = this.store.detail();
    if (!v || this.saving()) return;

    const char: NonNullable<VehicleUpdateRequest['characteristics']> = {};
    if (this.screenCount != null) char.screenCount = this.screenCount;
    if (this.passengerCapacity != null) char.passengerCapacity = this.passengerCapacity;

    const body: VehicleUpdateRequest = {
      registrationPlate: this.registrationPlate.trim(),
      make: this.make.trim(),
      model: this.model.trim(),
      year: this.year ?? undefined,
      commercialTier: this.commercialTier,
    };
    if (Object.keys(char).length > 0) {
      body.characteristics = char;
    }

    this.saving.set(true);
    this.inventory.updateVehicle(v.vehicleId, body).subscribe({
      next: (updated) => {
        this.store.replace(updated);
        this.saving.set(false);
        this.message.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Vehicle configuration was updated.',
        });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        let msg = 'Could not save changes.';
        if (err instanceof HttpErrorResponse) {
          const e = err.error as { message?: string; error?: { message?: string } };
          msg = e?.message ?? e?.error?.message ?? msg;
        }
        this.message.add({ severity: 'error', summary: 'Save failed', detail: msg });
      },
    });
  }
}
