import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  output,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';

export type GeoZoneCirclePayload = {
  center: { lng: number; lat: number };
  radiusMeters: number;
};

@Component({
  selector: 'app-geo-zone-map',
  standalone: true,
  imports: [ButtonModule, FormsModule],
  template: `
    <div class="mb-2 flex flex-wrap gap-2">
      <button
        pButton
        type="button"
        class="p-button-sm"
        [class.p-button-outlined]="drawMode() !== 'polygon'"
        (click)="setMode('polygon')"
      >
        Polygon
      </button>
      <button
        pButton
        type="button"
        class="p-button-sm"
        [class.p-button-outlined]="drawMode() !== 'circle'"
        (click)="setMode('circle')"
      >
        Circle
      </button>
    </div>
    <div
      #mapHost
      class="h-72 w-full rounded-lg border border-slate-200 dark:border-slate-600 z-0"
    ></div>
    @if (drawMode() === 'polygon') {
      <p class="mt-2 text-xs text-slate-500">
        Click the map to add polygon vertices (WGS84). Minimum 3 points, then close the ring.
      </p>
    } @else {
      <p class="mt-2 text-xs text-slate-500">
        Click once for the center, then click again on the map edge to set radius (meters), or enter
        radius below after placing the center.
      </p>
    }
    @if (drawMode() === 'circle' && circleCenter()) {
      <div class="mt-2 flex flex-wrap items-end gap-2">
        <label class="text-xs text-slate-600 dark:text-slate-400">
          Radius (m)
          <input
            type="number"
            min="10"
            step="1"
            class="ml-1 w-28 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
            [ngModel]="circleRadiusInput()"
            (ngModelChange)="onRadiusInput($event)"
          />
        </label>
      </div>
    }
    <div class="mt-2 flex flex-wrap gap-2">
      @if (drawMode() === 'polygon') {
        <button
          pButton
          type="button"
          class="p-button-sm p-button-secondary"
          (click)="undo()"
        >
          Undo last point
        </button>
        <button pButton type="button" class="p-button-sm" (click)="closeRing()">
          Close polygon
        </button>
      }
      @if (drawMode() === 'circle' && circleCenter() && circleRadiusMeters() > 0) {
        <button pButton type="button" class="p-button-sm" (click)="emitCircle()">
          Use this circle
        </button>
      }
      <button
        pButton
        type="button"
        class="p-button-sm p-button-text"
        (click)="clear()"
      >
        Clear
      </button>
    </div>
  `,
})
export class GeoZoneMapComponent implements AfterViewInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  /** GeoJSON Polygon coordinates (outer ring), lng/lat. */
  readonly polygonClosed = output<number[][][]>();
  /** Center + radius in meters (WGS84). */
  readonly circleDefined = output<GeoZoneCirclePayload>();

  protected readonly drawMode = signal<'polygon' | 'circle'>('polygon');
  /** Circle center in lng/lat; second click or manual radius updates preview. */
  protected readonly circleCenter = signal<[number, number] | null>(null);
  protected readonly circleRadiusMeters = signal(0);
  protected readonly circleRadiusInput = signal(500);

  private map: import('leaflet').Map | null = null;
  private layer: import('leaflet').LayerGroup | null = null;
  private ring: [number, number][] = [];

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    void this.initMap();
  }

  protected setMode(m: 'polygon' | 'circle'): void {
    this.drawMode.set(m);
    this.ring = [];
    this.circleCenter.set(null);
    this.circleRadiusMeters.set(0);
    void import('leaflet').then((L) => this.redraw(L));
  }

  protected onRadiusInput(v: number): void {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    this.circleRadiusInput.set(n);
    this.circleRadiusMeters.set(n);
    void import('leaflet').then((L) => this.redraw(L));
  }

  protected emitCircle(): void {
    const c = this.circleCenter();
    const r = this.circleRadiusMeters();
    if (!c || r <= 0) return;
    this.circleDefined.emit({
      center: { lng: c[0], lat: c[1] },
      radiusMeters: r,
    });
  }

  private async initMap(): Promise<void> {
    const L = await import('leaflet');
    const host = this.mapHost();
    if (!host) return;
    const el = host.nativeElement;
    this.map = L.map(el).setView([-23.55, -46.63], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    this.map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
      if (this.drawMode() === 'polygon') {
        this.ring.push([e.latlng.lng, e.latlng.lat]);
        this.redraw(L);
        return;
      }
      const lng = e.latlng.lng;
      const lat = e.latlng.lat;
      const cur = this.circleCenter();
      if (!cur) {
        this.circleCenter.set([lng, lat]);
        this.circleRadiusMeters.set(0);
        this.redraw(L);
        return;
      }
      const r = haversineMeters(cur[0], cur[1], lng, lat);
      if (r < 5) {
        return;
      }
      this.circleRadiusMeters.set(r);
      this.circleRadiusInput.set(Math.round(r));
      this.redraw(L);
    });
  }

  private redraw(L: typeof import('leaflet')): void {
    if (!this.layer || !this.map) return;
    this.layer.clearLayers();
    if (this.drawMode() === 'polygon') {
      if (this.ring.length === 0) return;
      const latlngs = this.ring.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(latlngs, { color: '#0ea5e9', weight: 2 }).addTo(this.layer);
      if (this.ring.length >= 3) {
        L.polygon(latlngs, {
          color: '#0284c7',
          weight: 1,
          fillOpacity: 0.15,
        }).addTo(this.layer);
      }
      return;
    }
    const c = this.circleCenter();
    if (!c) return;
    const r = this.circleRadiusMeters();
    const [lng, lat] = c;
    L.marker([lat, lng], { opacity: 0.9 }).addTo(this.layer);
    if (r > 0) {
      L.circle([lat, lng], {
        radius: r,
        color: '#0284c7',
        weight: 2,
        fillOpacity: 0.12,
      }).addTo(this.layer);
    }
  }

  protected undo(): void {
    if (this.drawMode() !== 'polygon') return;
    this.ring.pop();
    void import('leaflet').then((L) => this.redraw(L));
  }

  protected clear(): void {
    this.ring = [];
    this.circleCenter.set(null);
    this.circleRadiusMeters.set(0);
    void import('leaflet').then((L) => this.redraw(L));
  }

  protected closeRing(): void {
    if (this.ring.length < 3) return;
    const first = this.ring[0];
    const closed = [...this.ring, first];
    this.polygonClosed.emit([closed]);
  }
}

function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}
