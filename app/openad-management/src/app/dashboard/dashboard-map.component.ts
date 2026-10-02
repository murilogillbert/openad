import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { FleetStatusItem } from '@openad/api-contracts';
import { FleetDashboardService } from './fleet-dashboard.service';

const REFRESH_MS = 30_000;

@Component({
  selector: 'app-dashboard-map',
  standalone: true,
  template: `
    <div
      #mapHost
      class="h-[min(420px,55vh)] w-full rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40 z-0"
    ></div>
    @if (loadError()) {
      <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">
        {{ loadError() }}
      </p>
    }
    <p class="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
      <span
        ><span class="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500"></span
        >Online</span
      >
      <span
        ><span class="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500"></span
        >Degraded</span
      >
      <span
        ><span class="mr-1 inline-block h-2 w-2 rounded-full bg-red-500"></span
        >Offline</span
      >
    </p>
  `,
})
export class DashboardMapComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly fleet = inject(FleetDashboardService);
  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  readonly deviceSelected = output<string>();

  readonly loadError = signal<string | null>(null);

  private map: import('leaflet').Map | null = null;
  private layer: import('leaflet').LayerGroup | null = null;
  private readonly markers = new Map<
    string,
    import('leaflet').CircleMarker
  >();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private socketCleanup: (() => void) | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const L = await import('leaflet');
    const host = this.mapHost();
    if (!host) return;
    const el = host.nativeElement;
    this.map = L.map(el).setView([51.5, -0.12], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);

    await this.refreshMarkers(L);
    this.intervalId = setInterval(() => void this.refreshMarkers(L), REFRESH_MS);

    const { disconnect } = this.fleet.connectFleetSocket(() => {
      void this.refreshMarkers(L);
    });
    this.socketCleanup = disconnect;
  }

  private async refreshMarkers(L: typeof import('leaflet')): Promise<void> {
    this.fleet.getFleetStatus().subscribe({
      next: (res) => {
        this.loadError.set(null);
        this.renderFleet(L, res.data);
      },
      error: () => {
        this.loadError.set(
          'Could not load fleet status. Your account may need fleet_operator or fleet_admin access.'
        );
      },
    });
  }

  private renderFleet(L: typeof import('leaflet'), items: FleetStatusItem[]): void {
    if (!this.map || !this.layer) return;

    const nextIds = new Set(items.map((i) => i.deviceId));

    for (const [id, mk] of this.markers) {
      if (!nextIds.has(id)) {
        mk.remove();
        this.markers.delete(id);
      }
    }

    for (const item of items) {
      const color = markerColor(item.connectivity.status);
      const latlng: [number, number] = [item.location.lat, item.location.lng];
      let marker = this.markers.get(item.deviceId);
      if (!marker) {
        marker = L.circleMarker(latlng, {
          radius: 9,
          color: '#ffffff',
          weight: 2,
          fillColor: color,
          fillOpacity: 0.95,
        }).addTo(this.layer);
        marker.on('click', () => {
          this.deviceSelected.emit(item.deviceId);
        });
        this.markers.set(item.deviceId, marker);
      } else {
        marker.setLatLng(latlng);
        marker.setStyle({ fillColor: color });
      }
    }

    if (items.length > 0) {
      const bounds = L.latLngBounds(
        items.map((i) => [i.location.lat, i.location.lng])
      );
      this.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
    }
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.socketCleanup?.();
    this.map?.remove();
  }
}

function markerColor(
  status: FleetStatusItem['connectivity']['status']
): string {
  switch (status) {
    case 'online':
      return '#22c55e';
    case 'degraded':
      return '#f59e0b';
    case 'offline':
      return '#ef4444';
    default:
      return '#64748b';
  }
}
