import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import type { PlatformConfig } from '@openad/api-contracts';
import { PlatformConfigApiService } from './platform-config-api.service';

type ResolutionOption = {
  key: 'fhd' | 'qhd' | 'uhd4k';
  label: string;
  width: number;
  height: number;
};

@Component({
  selector: 'app-platform-config-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    SliderModule,
    ToggleSwitchModule,
    ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './platform-config.page.html',
})
export class PlatformConfigPage implements OnInit {
  private readonly api = inject(PlatformConfigApiService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly restoring = signal(false);

  protected readonly version = signal(0);
  protected readonly active = signal<PlatformConfig | null>(null);
  protected readonly defaults = signal<PlatformConfig | null>(null);

  protected readonly draft = signal<PlatformConfig | null>(null);
  protected readonly dirty = signal(false);

  protected readonly resolutionOptions: ResolutionOption[] = [
    { key: 'fhd', label: '1920×1080 (FHD)', width: 1920, height: 1080 },
    { key: 'qhd', label: '2560×1440 (QHD)', width: 2560, height: 1440 },
    { key: 'uhd4k', label: '3840×2160 (4K UHD)', width: 3840, height: 2160 },
  ];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.api.getConfig().subscribe({
      next: (r) => {
        this.version.set(r.version);
        this.active.set(r.active);
        this.defaults.set(r.defaults);
        this.draft.set(structuredClone(r.active));
        this.dirty.set(false);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Load failed',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });
  }

  markDirty(): void {
    this.dirty.set(true);
  }

  protected get selectedResolutionKey(): ResolutionOption['key'] {
    const d = this.draft();
    if (!d) return 'uhd4k';
    const match = this.resolutionOptions.find(
      (o) => o.width === d.mediaLimits.maxWidth && o.height === d.mediaLimits.maxHeight
    );
    return match?.key ?? 'uhd4k';
  }

  protected set selectedResolutionKey(key: ResolutionOption['key']) {
    const d = this.draft();
    if (!d) return;
    const o = this.resolutionOptions.find((x) => x.key === key);
    if (!o) return;
    d.mediaLimits.maxWidth = o.width;
    d.mediaLimits.maxHeight = o.height;
    // force signal update since we mutated nested object
    this.draft.set(structuredClone(d));
    this.markDirty();
  }

  save(): void {
    const d = this.draft();
    if (!d) return;
    this.saving.set(true);
    this.api
      .putConfig({ version: this.version(), config: d })
      .subscribe({
        next: (r) => {
          this.version.set(r.version);
          this.active.set(r.active);
          this.defaults.set(r.defaults);
          this.draft.set(structuredClone(r.active));
          this.dirty.set(false);
          this.saving.set(false);
          this.messages.add({ severity: 'success', summary: 'Saved' });
        },
        error: (e) => {
          this.saving.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Save failed',
            detail: e?.error?.message ?? String(e?.message ?? e),
          });
        },
      });
  }

  discard(): void {
    const a = this.active();
    if (!a) return;
    this.draft.set(structuredClone(a));
    this.dirty.set(false);
  }

  restoreDefaults(): void {
    const ok = window.confirm('Restore default platform settings?');
    if (!ok) return;
    this.restoring.set(true);
    this.api.restoreDefaults({ version: this.version() }).subscribe({
      next: (r) => {
        this.version.set(r.version);
        this.active.set(r.active);
        this.defaults.set(r.defaults);
        this.draft.set(structuredClone(r.active));
        this.dirty.set(false);
        this.restoring.set(false);
        this.messages.add({ severity: 'success', summary: 'Defaults restored' });
      },
      error: (e) => {
        this.restoring.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Restore failed',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });
  }
}

