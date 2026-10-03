import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ImpressionEventDetail } from '@openad/api-contracts';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { EMPTY, map, switchMap } from 'rxjs';
import { ReportsApiService } from '../reports-api.service';
import { CentsPipe } from '../../shared/cents.pipe';

@Component({
  selector: 'app-impression-detail',
  standalone: true,
  imports: [RouterLink, CardModule, TagModule, CentsPipe],
  template: `
    <div class="space-y-6 p-4 md:p-6">
      <div class="flex flex-wrap items-center gap-3">
        <a routerLink="/reports" class="text-sm text-primary-600 hover:underline"
          >← Back to reports</a
        >
      </div>

      @if (loading()) {
        <p class="text-slate-600">Loading impression…</p>
      } @else if (error()) {
        <p class="text-red-600">{{ error() }}</p>
      } @else if (detail()) {
        @let d = detail()!;

        <h1 class="app-font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Impression
        </h1>
        <p class="font-mono text-sm text-slate-500">{{ d.eventId }}</p>

        <div class="grid gap-4 lg:grid-cols-2">
          <p-card header="Playback & billing">
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Played</dt>
                <dd>{{ d.playedAt }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Received</dt>
                <dd>{{ d.receivedAt }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Duration</dt>
                <dd>{{ d.durationPlayedSeconds }}s</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Vehicle</dt>
                <dd class="font-mono text-xs">{{ d.vehicleId }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Device</dt>
                <dd class="font-mono text-xs">{{ d.deviceId }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Campaign</dt>
                <dd class="font-mono text-xs">{{ d.campaignId }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Creative asset</dt>
                <dd class="font-mono text-xs">{{ d.assetId }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Location verified</dt>
                <dd>
                  <p-tag
                    [severity]="d.locationVerified ? 'success' : 'warn'"
                    [value]="d.locationVerified ? 'Yes' : 'No'"
                  />
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Billing value</dt>
                <dd>{{ d.billingValueCents | cents }} {{ d.currency }}</dd>
              </div>
            </dl>
          </p-card>

          <p-card header="Location">
            <div
              #mapHost
              class="h-[min(360px,50vh)] w-full rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40"
            ></div>
            @if (
              d.location.lat === null ||
              d.location.lat === undefined ||
              d.location.lng === null ||
              d.location.lng === undefined
            ) {
              <p class="mt-2 text-sm text-slate-500">
                No coordinates stored for this impression.
              </p>
            }
          </p-card>
        </div>
      }
    </div>
  `,
})
export class ImpressionDetailComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly reportsApi = inject(ReportsApiService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  private map: import('leaflet').Map | null = null;
  private marker: import('leaflet').Layer | null = null;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<ImpressionEventDetail | null>(null);

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => p.get('eventId') ?? ''),
        switchMap((eventId) => {
          if (!eventId) {
            this.loading.set(false);
            this.error.set('Missing event id');
            return EMPTY;
          }
          this.loading.set(true);
          this.error.set(null);
          this.detail.set(null);
          return this.reportsApi.getImpression(eventId);
        })
      )
      .subscribe({
        next: (d) => {
          this.detail.set(d);
          this.loading.set(false);
          queueMicrotask(() => {
            if (isPlatformBrowser(this.platformId)) {
              void this.renderMapWhenReady(d);
            }
          });
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Impression not found or access denied.');
        },
      });
  }

  ngAfterViewInit(): void {
    const d = this.detail();
    if (d && isPlatformBrowser(this.platformId)) {
      void this.renderMapWhenReady(d);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.marker = null;
  }

  private async renderMapWhenReady(d: ImpressionEventDetail): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (d.location.lat == null || d.location.lng == null) return;

    const L = await import('leaflet');
    const host = this.mapHost();
    if (!host) return;
    const el = host.nativeElement;

    if (!this.map) {
      this.map = L.map(el).setView([d.location.lat, d.location.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
    } else {
      this.map.setView([d.location.lat, d.location.lng], 14);
    }

    if (this.marker) {
      this.map.removeLayer(this.marker);
    }
    this.marker = L.marker([d.location.lat, d.location.lng]).addTo(this.map);
  }
}
