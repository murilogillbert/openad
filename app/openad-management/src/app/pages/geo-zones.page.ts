import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CampaignsApiService } from '../campaigns/campaigns-api.service';
import {
  GeoZoneCirclePayload,
  GeoZoneMapComponent,
} from '../geo-zones/geo-zone-map.component';

@Component({
  selector: 'app-geo-zones-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    GeoZoneMapComponent,
  ],
  template: `
    <h1 class="app-font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
      Geo zones
    </h1>
    <p class="mt-1 text-slate-600 dark:text-slate-400">
      Draw a polygon or circle on the map, then save. Coordinates use WGS84 (lng, lat).
    </p>
    <div class="mt-6 grid max-w-xl gap-3">
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Name</div>
      <input id="gz-name" pInputText class="w-full" [(ngModel)]="name" />
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">City</div>
      <input id="gz-city" pInputText class="w-full" [(ngModel)]="city" />
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Tier</div>
      <select
        id="gz-tier"
        class="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        [(ngModel)]="tier"
      >
        <option value="T1">T1</option>
        <option value="T2">T2</option>
        <option value="T3">T3</option>
        <option value="T4">T4</option>
      </select>
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Priority score</div>
      <input
        id="gz-priority"
        pInputText
        type="number"
        class="w-full"
        [(ngModel)]="priorityScore"
      />
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">
        Creative media ID (UUID) — optional; adds spatial binding for manifest
      </div>
      <input id="gz-media" pInputText class="w-full" [(ngModel)]="mediaId" placeholder="00000000-0000-0000-0000-000000000000" />
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Trigger</div>
      <select
        id="gz-trigger"
        class="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        [(ngModel)]="triggerMode"
      >
        <option value="entry">entry</option>
        <option value="dwell">dwell</option>
      </select>
      @if (triggerMode === 'dwell') {
        <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Dwell seconds</div>
        <input id="gz-dwell" pInputText type="number" class="w-full" [(ngModel)]="dwellSeconds" />
      }
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Rotation</div>
      <select
        id="gz-rotation"
        class="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        [(ngModel)]="rotationMode"
      >
        <option value="sequential">sequential</option>
        <option value="weighted_random">weighted_random</option>
        <option value="priority_first">priority_first</option>
      </select>
      <div class="text-sm font-medium text-slate-700 dark:text-slate-300">Cooldown (seconds)</div>
      <input id="gz-cool" pInputText type="number" class="w-full" [(ngModel)]="cooldownSeconds" />
    </div>
    <div class="mt-6 max-w-3xl">
      <app-geo-zone-map
        (polygonClosed)="onPolygon($event)"
        (circleDefined)="onCircle($event)"
      />
    </div>
    <div class="mt-4">
      <button
        pButton
        type="button"
        [loading]="saving()"
        [disabled]="!zoneGeometry()"
        (click)="save()"
      >
        Save zone
      </button>
    </div>
  `,
})
export class GeoZonesPage {
  private readonly api = inject(CampaignsApiService);
  private readonly messages = inject(MessageService);

  protected name = 'Downtown';
  protected city = 'SaoPaulo';
  protected tier: 'T1' | 'T2' | 'T3' | 'T4' = 'T4';
  protected priorityScore = 0;
  protected mediaId = '';
  protected triggerMode: 'entry' | 'dwell' = 'entry';
  protected dwellSeconds = 30;
  protected rotationMode:
    | 'sequential'
    | 'weighted_random'
    | 'priority_first' = 'sequential';
  protected cooldownSeconds = 60;
  protected readonly zoneGeometry = signal<
    | { type: 'Polygon'; coordinates: number[][][] }
    | {
        type: 'Circle';
        center: { lng: number; lat: number };
        radiusMeters: number;
      }
    | null
  >(null);
  protected readonly saving = signal(false);

  protected onPolygon(c: number[][][]): void {
    this.zoneGeometry.set({ type: 'Polygon', coordinates: c });
  }

  protected onCircle(c: GeoZoneCirclePayload): void {
    this.zoneGeometry.set({
      type: 'Circle',
      center: c.center,
      radiusMeters: c.radiusMeters,
    });
  }

  protected save(): void {
    const geometry = this.zoneGeometry();
    if (!geometry) return;
    this.saving.set(true);
    const bindings =
      this.mediaId.trim().length > 0
        ? [
            {
              mediaId: this.mediaId.trim(),
              triggerMode: this.triggerMode,
              dwellSeconds:
                this.triggerMode === 'dwell'
                  ? Number(this.dwellSeconds)
                  : undefined,
              retriggerCooldownSeconds: Number(this.cooldownSeconds),
              rotationMode: this.rotationMode,
            },
          ]
        : undefined;
    this.api
      .createGeoZone({
        name: this.name,
        description: 'Created from portal map',
        city: this.city,
        geometry,
        tags: ['portal'],
        tier: this.tier,
        priorityScore: Number(this.priorityScore),
        bindings,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.messages.add({
            severity: 'success',
            summary: 'Geo zone saved',
          });
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }
}
