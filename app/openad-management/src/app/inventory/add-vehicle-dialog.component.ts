import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { CreateVehicleRequest, DeviceInventoryItem } from '@openad/api-contracts';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  finalize,
  switchMap,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InventoryService } from './inventory.service';

type DeviceSelectOption = { deviceId: string; label: string };

@Component({
  selector: 'app-add-vehicle-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    MultiSelectModule,
  ],
  templateUrl: './add-vehicle-dialog.component.html',
  styleUrl: './add-vehicle-dialog.component.css',
})
export class AddVehicleDialogComponent {
  readonly visible = input(false);
  readonly visibleChange = output<boolean>();
  readonly created = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly inventory = inject(InventoryService);
  private readonly message = inject(MessageService);

  protected submitting = false;
  protected deviceOptions: DeviceSelectOption[] = [];
  protected deviceLoading = false;

  private readonly deviceMeta = new Map<string, DeviceSelectOption>();
  private readonly search$ = new Subject<string>();

  protected readonly tierOptions = [
    { label: 'Premium', value: 'premium' },
    { label: 'Taxi', value: 'taxi' },
    { label: 'Van', value: 'van' },
    { label: 'Other', value: 'other' },
  ];

  readonly form = this.fb.nonNullable.group({
    registrationPlate: ['', [Validators.required, Validators.maxLength(32)]],
    make: ['', [Validators.required, Validators.maxLength(64)]],
    model: ['', [Validators.required, Validators.maxLength(64)]],
    year: [new Date().getFullYear(), [Validators.required]],
    commercialTier: ['other' as const, Validators.required],
    pairedDeviceIds: [[] as string[]],
  });

  constructor() {
    this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          this.deviceLoading = true;
          return this.inventory
            .listDevices({
              search: q.trim() || undefined,
              page: 1,
              limit: 40,
            })
            .pipe(finalize(() => (this.deviceLoading = false)));
        }),
        takeUntilDestroyed()
      )
      .subscribe((res) => {
        this.deviceOptions = this.mergeOptions(res.data);
      });

    effect(() => {
      if (!this.visible()) {
        this.resetForm();
      }
    });
  }

  protected onVisibleChange(v: boolean): void {
    this.visibleChange.emit(v);
  }

  protected onDevicePanelShow(): void {
    this.search$.next('');
  }

  protected onDeviceFilter(ev: { filter?: string | null }): void {
    const f = ev?.filter;
    this.search$.next(typeof f === 'string' ? f : '');
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: CreateVehicleRequest = {
      registrationPlate: v.registrationPlate.trim(),
      make: v.make.trim(),
      model: v.model.trim(),
      year: v.year,
      commercialTier: v.commercialTier,
      pairedDeviceIds:
        v.pairedDeviceIds.length > 0 ? v.pairedDeviceIds : undefined,
    };

    this.submitting = true;
    this.inventory.createVehicle(body).subscribe({
      next: () => {
        this.submitting = false;
        this.message.add({
          severity: 'success',
          summary: 'Vehicle created',
          detail: `${body.registrationPlate} is in the fleet.`,
        });
        this.visibleChange.emit(false);
        this.created.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.submitting = false;
        const body = err.error as
          | { message?: string; code?: string; error?: { message?: string } }
          | undefined;
        const msg =
          body?.message ??
          body?.error?.message ??
          (body?.code ? String(body.code) : null) ??
          `HTTP ${err.status}`;
        this.message.add({
          severity: 'error',
          summary: 'Could not create vehicle',
          detail: msg,
        });
      },
    });
  }

  private mergeOptions(rows: DeviceInventoryItem[]): DeviceSelectOption[] {
    const map = new Map<string, DeviceSelectOption>();
    const selected = this.form.controls.pairedDeviceIds.getRawValue() ?? [];
    for (const id of selected) {
      const m = this.deviceMeta.get(id);
      if (m) {
        map.set(id, m);
      }
    }
    for (const d of rows) {
      const o = this.toOpt(d);
      map.set(d.deviceId, o);
      this.deviceMeta.set(d.deviceId, o);
    }
    return [...map.values()];
  }

  private toOpt(d: DeviceInventoryItem): DeviceSelectOption {
    const plate = d.boundVehicleRegistrationPlate;
    const bind = plate ? ` · ${plate}` : ' · unbound';
    return {
      deviceId: d.deviceId,
      label: `${d.serialNumber}${bind} · ${d.deviceId}`,
    };
  }

  private resetForm(): void {
    this.form.reset({
      registrationPlate: '',
      make: '',
      model: '',
      year: new Date().getFullYear(),
      commercialTier: 'other',
      pairedDeviceIds: [],
    });
    this.deviceMeta.clear();
    this.deviceOptions = [];
    this.submitting = false;
  }
}
