import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import type {
  FleetMapMarker,
  FleetMapMetaResponse,
} from '@openad/api-contracts';
/**
 * Default import: same `exports` object Leaflet assigns to `window.L` and that
 * `leaflet.markercluster` mutates (`markerClusterGroup` is not a static ESM export).
 * `import * as L` is a module namespace and can omit those runtime-only props in prod.
 */
import L from 'leaflet';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster';
import { map } from 'rxjs';
import { finalize } from 'rxjs';
import type { FleetMapSnapshotStreamHandle } from '../fleet/fleet-map-api.service';
import { FleetMapApiService } from '../fleet/fleet-map-api.service';

/** Light “brand” raster base (Carto Voyager). */
const TILE_LIGHT =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Esri World Transportation overlay (roads/rail/transit infrastructure). */
const TILE_TRANSIT_ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const TILE_TRANSIT_ATTRIB =
  'Transportation &copy; <a href="https://www.esri.com/">Esri</a>';

/** Default center (Brasília) when geolocation is denied or unavailable. */
const DEFAULT_CENTER: L.LatLngTuple = [-15.793889, -47.882778];

@Component({
  selector: 'app-fleet-map-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    DrawerModule,
    InputTextModule,
    MultiSelectModule,
    ToggleSwitchModule,
    TooltipModule,
  ],
  templateUrl: './fleet-map.page.html',
  styleUrl: './fleet-map.page.css',
  host: {
    class:
      'fixed left-0 right-0 z-[25] block bg-surface-0 max-md:top-0 max-md:bottom-0 md:top-16 md:bottom-0',
  },
})
export class FleetMapPage implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly fleetApi = inject(FleetMapApiService);
  private readonly messages = inject(MessageService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostEl = inject(ElementRef<HTMLElement>);

  /** Matches Tailwind `md` — filter drawer fullscreen on small viewports. */
  readonly isMobileLayout = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 767px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  readonly filterDrawerPanelStyle = computed(() =>
    this.isMobileLayout()
      ? { width: '100%', maxWidth: '100%' }
      : { width: 'min(420px, 100vw)' }
  );

  readonly mapHost = viewChild.required<ElementRef<HTMLElement>>('mapHost');
  readonly fleetRoot = viewChild.required<ElementRef<HTMLElement>>('fleetRoot');

  /** PrimeNG Drawer `appendTo` must be an `HTMLElement` (template `#ref` is not reliable). */
  get drawerMountEl(): HTMLElement {
    return this.fleetRoot().nativeElement;
  }

  readonly meta = signal<FleetMapMetaResponse | null>(null);
  readonly snapshot = signal<import('@openad/api-contracts').FleetMapSnapshotResponse | null>(
    null
  );
  readonly loading = signal(false);
  readonly detail = signal<import('@openad/api-contracts').FleetMapDeviceDetailResponse | null>(
    null
  );
  readonly detailLoading = signal(false);
  readonly selectedDeviceId = signal<string | null>(null);

  readonly legendOpen = signal(false);
  readonly filterDrawerOpen = signal(false);
  readonly configOpen = signal(false);
  /** Browser Fullscreen API active on this page (host or inner shell). Drives spacer + stats offset. */
  readonly browserMapFullscreen = signal(false);

  /** Bottom offset for custom zoom/locate stack (above mobile nav, or inset in fullscreen / desktop). */
  readonly mapZoomChromeBottom = computed(() => {
    if (this.browserMapFullscreen()) {
      return '1rem';
    }
    if (this.isMobileLayout()) {
      return 'calc(5.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)';
    }
    return '1rem';
  });

  readonly filterCities = signal<string[]>([]);
  readonly filterDeviceStatuses = signal<('online' | 'offline' | 'syncing')[]>([
    'online',
    'offline',
    'syncing',
  ]);
  readonly filterPlates = signal('');
  readonly filterDeviceName = signal('');
  readonly filterCategories = signal<('premium' | 'taxi' | 'van' | 'other')[]>([]);
  readonly filterCampaignIds = signal<string[]>([]);

  readonly mapClustering = signal(true);
  readonly mapGeofences = signal(true);
  /** Esri World Transportation overlay */
  readonly mapTransit = signal(false);
  readonly mapShowNames = signal(true);

  readonly statusOptions: ('online' | 'offline' | 'syncing')[] = [
    'online',
    'offline',
    'syncing',
  ];

  readonly countsLine = computed(() => {
    const s = this.snapshot();
    if (!s) return '';
    const c = s.counts;
    return `${c.moving} Moving | ${c.idle} Idle | ${c.syncing} Syncing | ${c.offline} Offline`;
  });

  private map: L.Map | null = null;
  private clusterGroup: L.LayerGroup | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private geofenceLayer: L.LayerGroup | null = null;
  private transitLayer: L.TileLayer | null = null;
  private readonly markerByDevice = new Map<string, L.Layer>();
  private fleetStream: FleetMapSnapshotStreamHandle | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.fleetApi
      .getMeta()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.meta.set(m),
        error: () =>
          this.messages.add({
            severity: 'error',
            summary: 'Fleet map',
            detail: 'Failed to load filter metadata',
          }),
      });
    queueMicrotask(() => this.initMap());

    this.loading.set(true);
    this.fleetStream = this.fleetApi.connectFleetMapSnapshotStream({
      getQuery: () => ({
        cities: this.filterCities(),
        deviceName: this.filterDeviceName(),
        deviceStatuses: this.filterDeviceStatuses(),
        plates: this.filterPlates(),
        commercialTiers: this.filterCategories(),
        campaignIds: this.filterCampaignIds(),
      }),
      onSnapshot: (snap) => {
        this.loading.set(false);
        this.snapshot.set(snap);
        this.applyMarkers(snap.markers);
        this.applyGeofences(snap.zones);
      },
      onStreamError: (code) => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Fleet map',
          detail:
            code === 'forbidden'
              ? 'You do not have access to the live fleet map.'
              : code === 'connect_error'
                ? 'Could not connect to live fleet updates.'
                : 'Live map update failed.',
        });
      },
    });

    const onFsChange = (): void => {
      this.syncBrowserFullscreenFromDocument();
      this.invalidateMapLayout();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    });
    queueMicrotask(() => this.syncBrowserFullscreenFromDocument());
  }

  ngOnDestroy(): void {
    this.fleetStream?.disconnect();
    this.fleetStream = null;
    this.map?.remove();
    this.map = null;
  }

  private initMap(): void {
    const el = this.mapHost()?.nativeElement;
    if (!el) return;
    this.map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
    }).setView(DEFAULT_CENTER, 11);
    L.tileLayer(TILE_LIGHT, { attribution: TILE_ATTRIB, maxZoom: 19 }).addTo(
      this.map
    );
    this.transitLayer = L.tileLayer(TILE_TRANSIT_ESRI, {
      attribution: TILE_TRANSIT_ATTRIB,
      maxZoom: 19,
      opacity: 0.78,
    });
    if (this.mapTransit()) {
      this.transitLayer.addTo(this.map);
    }
    this.map.attributionControl.setPosition('bottomleft');
    this.requestInitialGeolocation();
    this.geofenceLayer = L.layerGroup().addTo(this.map);
    this.rebuildClusterGroup();
  }

  mapZoomIn(): void {
    if (!this.map) return;
    this.map.zoomIn();
  }

  mapZoomOut(): void {
    if (!this.map) return;
    this.map.zoomOut();
  }

  /** Re-center using browser geolocation (permission prompt if needed). */
  locateUser(): void {
    if (!isPlatformBrowser(this.platformId) || !this.map) return;
    if (!navigator.geolocation) {
      this.messages.add({
        severity: 'warn',
        summary: 'Location',
        detail: 'Geolocation is not available in this browser.',
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map?.flyTo(
          [pos.coords.latitude, pos.coords.longitude],
          Math.max(this.map?.getZoom() ?? 14, 14),
          { duration: 0.6 }
        );
      },
      () => {
        this.messages.add({
          severity: 'warn',
          summary: 'Location',
          detail: 'Could not read your position. Check browser permissions.',
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  private requestInitialGeolocation(): void {
    if (!isPlatformBrowser(this.platformId) || !this.map) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map?.setView(
          [pos.coords.latitude, pos.coords.longitude],
          12,
          { animate: false }
        );
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 }
    );
  }

  private rebuildClusterGroup(): void {
    if (!this.map) return;
    if (this.clusterGroup) {
      this.map.removeLayer(this.clusterGroup);
      this.clusterGroup = null;
    }
    if (this.markersLayer) {
      this.map.removeLayer(this.markersLayer);
      this.markersLayer = null;
    }
    if (this.mapClustering()) {
      const Mcg = L.markerClusterGroup;
      this.clusterGroup = Mcg({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction: (cluster: {
          getChildCount: () => number;
          getAllChildMarkers: () => L.Layer[];
        }) => {
          const n = cluster.getChildCount();
          const children = cluster.getAllChildMarkers();
          const tally: Record<string, number> = {};
          for (const layer of children) {
            const motion = (layer as L.Layer & { __fleetMotion?: string }).__fleetMotion ?? 'idle';
            tally[motion] = (tally[motion] ?? 0) + 1;
          }
          const order = ['offline', 'syncing', 'moving', 'idle'] as const;
          let dominant = 'idle';
          let best = -1;
          for (const k of order) {
            const c = tally[k] ?? 0;
            if (c > best) {
              best = c;
              dominant = k;
            }
          }
          const bg =
            dominant === 'offline'
              ? '#b91c1c'
              : dominant === 'syncing'
                ? '#ca8a04'
                : dominant === 'moving'
                  ? '#16a34a'
                  : '#64748b';
          return L.divIcon({
            html: `<div style="background:${bg};color:#fff;width:40px;height:40px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;border:3px solid rgba(255,255,255,.6);">${n}</div>`,
            className: 'fleet-cluster-icon',
            iconSize: [40, 40],
          });
        },
      });
      this.map.addLayer(this.clusterGroup);
    } else {
      this.markersLayer = L.layerGroup();
      this.map.addLayer(this.markersLayer);
    }
  }

  applyFilters(): void {
    this.filterDrawerOpen.set(false);
    this.syncShellElevation();
    this.loading.set(true);
    this.fleetStream?.pushFilters();
  }

  /** Keep shell above bottom nav (z-50) while filter/config overlays are open — must run synchronously with signal updates. */
  private syncShellElevation(): void {
    const elevated = this.filterDrawerOpen() || this.configOpen();
    this.hostEl.nativeElement.style.zIndex = elevated ? '120' : '';
  }

  openFilterDrawer(): void {
    this.filterDrawerOpen.set(true);
    this.syncShellElevation();
    queueMicrotask(() => this.map?.invalidateSize());
  }

  openMapConfig(): void {
    this.configOpen.set(true);
    this.syncShellElevation();
    queueMicrotask(() => this.map?.invalidateSize());
  }

  onFilterDrawerVisible(open: boolean): void {
    this.filterDrawerOpen.set(open);
    this.syncShellElevation();
    queueMicrotask(() => this.map?.invalidateSize());
  }

  onConfigVisible(open: boolean): void {
    this.configOpen.set(open);
    this.syncShellElevation();
    queueMicrotask(() => this.map?.invalidateSize());
  }

  private applyMarkers(markers: FleetMapMarker[]): void {
    if (!this.map) return;
    const target = this.mapClustering() ? this.clusterGroup : this.markersLayer;
    if (!target) return;
    target.clearLayers();
    this.markerByDevice.clear();

    for (const m of markers) {
      const color =
        m.motionState === 'offline'
          ? '#dc2626'
          : m.motionState === 'syncing'
            ? '#ca8a04'
            : m.motionState === 'moving'
              ? '#22c55e'
              : '#64748b';
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: m.motionState === 'moving' ? 11 : 8,
        color: '#fff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      });
      marker.on('click', () => this.openDetail(m.deviceId));
      (marker as L.CircleMarker & { __fleetMotion?: string }).__fleetMotion =
        m.motionState;
      const label = this.mapShowNames()
        ? `<div class="fleet-map-label">${m.deviceLabel}</div>`
        : '';
      marker.bindTooltip(
        `${label}<div class="text-xs opacity-90">${m.registrationPlate}</div>`,
        { direction: 'top', className: 'fleet-map-tip' }
      );
      marker.addTo(target);
      this.markerByDevice.set(m.deviceId, marker);
    }
  }

  private applyGeofences(
    zones: import('@openad/api-contracts').FleetMapZoneOutline[]
  ): void {
    if (!this.map || !this.geofenceLayer) return;
    this.geofenceLayer.clearLayers();
    if (!this.mapGeofences()) return;
    for (const z of zones) {
      if (z.geometry.type === 'Polygon') {
        const latlngs = z.geometry.coordinates[0].map(([lng, lat]) =>
          L.latLng(lat, lng)
        );
        L.polygon(latlngs, {
          color: '#22d3ee',
          weight: 2,
          fillColor: '#22d3ee',
          fillOpacity: 0.12,
        })
          .bindTooltip(z.name)
          .addTo(this.geofenceLayer);
      } else if (z.geometry.type === 'Circle') {
        L.circle([z.geometry.center.lat, z.geometry.center.lng], {
          radius: z.geometry.radiusMeters,
          color: '#22d3ee',
          weight: 2,
          fillColor: '#22d3ee',
          fillOpacity: 0.1,
        })
          .bindTooltip(z.name)
          .addTo(this.geofenceLayer);
      }
    }
  }

  openDetail(deviceId: string): void {
    this.selectedDeviceId.set(deviceId);
    this.detail.set(null);
    this.detailLoading.set(true);
    this.fleetApi
      .getDeviceDetail(deviceId)
      .pipe(
        finalize(() => this.detailLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (d) => this.detail.set(d),
        error: () => {
          this.messages.add({
            severity: 'error',
            summary: 'Device',
            detail: 'Could not load detail',
          });
          this.closeDetail();
        },
      });
  }

  closeDetail(): void {
    this.detail.set(null);
    this.selectedDeviceId.set(null);
  }

  sparkHeight(
    count: number,
    rows: { count: number }[]
  ): number {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return Math.max(8, (count / max) * 100);
  }

  onMapShowNamesChange(): void {
    const snap = this.snapshot();
    if (snap) this.applyMarkers(snap.markers);
  }

  toggleLegend(): void {
    this.legendOpen.update((v) => !v);
  }

  /**
   * Fullscreen the whole `app-fleet-map-page` host so the layer matches the viewport (avoids a dead band
   * when only the inner shell was fullscreen). Spacer + stats bar react via `browserMapFullscreen`.
   */
  toggleFullscreen(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const host = this.hostEl.nativeElement;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const isFs = !!document.fullscreenElement || !!doc.webkitFullscreenElement;

    if (!isFs) {
      const htmlHost = host as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      const req =
        host.requestFullscreen?.bind(host) ?? htmlHost.webkitRequestFullscreen?.bind(host);
      if (!req) {
        this.messages.add({
          severity: 'warn',
          summary: 'Fullscreen',
          detail: 'Fullscreen is not supported here. Try rotating the device or use a desktop browser.',
        });
        return;
      }
      void req()
        .then(() => {
          this.syncBrowserFullscreenFromDocument();
          this.invalidateMapLayout();
        })
        .catch(() =>
          this.messages.add({
            severity: 'warn',
            summary: 'Fullscreen',
            detail: 'Could not enter fullscreen.',
          })
        );
    } else {
      const exit =
        document.exitFullscreen?.bind(document) ??
        doc.webkitExitFullscreen?.bind(document);
      if (exit) void exit();
      queueMicrotask(() => {
        this.syncBrowserFullscreenFromDocument();
        this.invalidateMapLayout();
      });
    }
  }

  private syncBrowserFullscreenFromDocument(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const fs = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    const host = this.hostEl.nativeElement;
    const root = this.fleetRoot()?.nativeElement;
    if (!fs) {
      this.browserMapFullscreen.set(false);
      return;
    }
    const onOurPage =
      fs === host ||
      fs === root ||
      host.contains(fs) ||
      (root != null && root.contains(fs));
    this.browserMapFullscreen.set(!!onOurPage);
  }

  private invalidateMapLayout(): void {
    queueMicrotask(() => {
      this.map?.invalidateSize();
      requestAnimationFrame(() => this.map?.invalidateSize());
    });
  }

  onClusteringChange(): void {
    this.rebuildClusterGroup();
    const snap = this.snapshot();
    if (snap) this.applyMarkers(snap.markers);
  }

  onGeofenceToggle(): void {
    const snap = this.snapshot();
    if (snap) this.applyGeofences(snap.zones);
  }

  onTransitToggle(): void {
    if (!this.map || !this.transitLayer) return;
    if (this.mapTransit()) {
      this.transitLayer.addTo(this.map);
    } else {
      this.map.removeLayer(this.transitLayer);
    }
  }

  editDevice(): void {
    const d = this.detail();
    if (!d) return;
    void this.router.navigate([
      '/devices',
      'vehicles',
      d.vehicleId,
      'overview',
    ]);
  }

  pingDevice(): void {
    const id = this.selectedDeviceId();
    if (!id) return;
    this.fleetApi.pingDevice(id).subscribe({
      next: () =>
        this.messages.add({
          severity: 'success',
          summary: 'MQTT',
          detail: 'Command queued',
        }),
      error: () =>
        this.messages.add({
          severity: 'error',
          summary: 'MQTT',
          detail: 'Command failed',
        }),
    });
  }
}
