import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, output } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { DeviceInventoryRegisterRequest } from '@openad/api-contracts';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InventoryService } from './inventory.service';

@Component({
  selector: 'app-device-bind-dialog',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    DialogModule,
    ButtonModule,
  ],
  templateUrl: './device-bind-dialog.component.html',
})
export class DeviceBindDialogComponent {
  readonly visible = input(false);
  readonly visibleChange = output<boolean>();
  /** Emitted after successful registration so parent can refresh lists. */
  readonly bound = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly inventory = inject(InventoryService);
  private readonly message = inject(MessageService);

  submitting = false;

  readonly form = this.fb.nonNullable.group({
    serialNumber: ['', Validators.required],
    screenSizeInches: [''],
    osVersion: [''],
    storageCapacityGb: [''],
  });

  protected submit(): void {
    if (this.form.controls.serialNumber.invalid) {
      this.form.controls.serialNumber.markAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const serial = v.serialNumber.trim();
    if (!serial) {
      this.form.controls.serialNumber.markAsTouched();
      return;
    }

    const inchRaw = String(v.screenSizeInches).trim();
    const gbRaw = String(v.storageCapacityGb).trim();

    if (inchRaw) {
      const n = Number(inchRaw);
      if (!Number.isFinite(n) || n < 0.1) {
        this.message.add({
          severity: 'warn',
          summary: 'Invalid diagonal',
          detail: 'Enter a positive number in inches, or leave empty.',
        });
        return;
      }
    }
    if (gbRaw) {
      const n = parseInt(gbRaw, 10);
      if (!Number.isFinite(n) || n < 1) {
        this.message.add({
          severity: 'warn',
          summary: 'Invalid storage',
          detail: 'Enter whole GB ≥ 1, or leave empty.',
        });
        return;
      }
    }

    const body: DeviceInventoryRegisterRequest = { serialNumber: serial };
    if (inchRaw) {
      body.screenSizeInches = Number(inchRaw);
    }
    const os = v.osVersion.trim();
    if (os) {
      body.osVersion = os;
    }
    if (gbRaw) {
      body.storageCapacityGb = parseInt(gbRaw, 10);
    }

    this.submitting = true;
    this.inventory.registerInventoryDevice(body).subscribe({
      next: () =>
        this.onSuccess(
          'Tablet registered. Screen resolution and full hardware details are filled when the device connects. Pair to a vehicle from the pairing flow.'
        ),
      error: (err: HttpErrorResponse) => this.onError(err),
    });
  }

  private onSuccess(detail: string): void {
    this.submitting = false;
    this.message.add({
      severity: 'success',
      summary: 'Registered',
      detail,
    });
    this.form.reset({
      serialNumber: '',
      screenSizeInches: '',
      osVersion: '',
      storageCapacityGb: '',
    });
    this.visibleChange.emit(false);
    this.bound.emit();
  }

  private onError(err: HttpErrorResponse): void {
    this.submitting = false;
    if (err.status === 409) {
      this.message.add({
        severity: 'warn',
        summary: 'Serial already in inventory',
        detail:
          'That serial is already registered. Use the pairing queue or inventory list to continue.',
      });
      return;
    }
    const body = err.error as { message?: string; error?: { message?: string } } | undefined;
    const msg =
      body?.message ??
      body?.error?.message ??
      'Registration failed. Check the serial and try again.';
    this.message.add({
      severity: 'error',
      summary: 'Registration failed',
      detail: msg,
    });
  }
}
