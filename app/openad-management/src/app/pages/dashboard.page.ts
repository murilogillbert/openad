import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type {
  DashboardCampaignPacingItem,
  DashboardCriticalAlert,
  DashboardSummaryResponse,
  FleetStatusItem,
} from '@openad/api-contracts';
import {
  catchError,
  interval,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { DashboardSummaryService } from '../dashboard/dashboard-summary.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly summaryApi = inject(DashboardSummaryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly summary = signal<DashboardSummaryResponse | null>(null);

  readonly fleetItems = computed(
    () => this.summary()?.fleet.data ?? ([] as FleetStatusItem[])
  );

  readonly networkOnline = computed(
    () => this.summary()?.kpis.networkOnline ?? 0
  );
  readonly networkTotal = computed(
    () => this.summary()?.kpis.networkTotal ?? 0
  );

  readonly networkPct = computed(() => {
    const s = this.summary();
    const t = s?.kpis.networkTotal ?? 0;
    if (!t) return 0;
    return Math.round(((s?.kpis.networkOnline ?? 0) / t) * 1000) / 10;
  });

  readonly activeCampaignCount = computed(
    () => this.summary()?.kpis.activeCampaigns.count ?? 0
  );
  readonly campaignSegmentFill = computed(
    () => this.summary()?.kpis.activeCampaigns.segmentFill ?? 0
  );

  readonly impressions24h = computed(
    () => this.summary()?.kpis.impressions24h.count ?? 0
  );
  readonly impressionsDelta = computed(
    () => this.summary()?.kpis.impressions24h.deltaPercent ?? null
  );
  readonly sparklineCounts = computed(
    () => this.summary()?.kpis.impressions24h.sparklineDailyCounts ?? []
  );

  readonly mediaUsedPercent = computed(
    () => this.summary()?.kpis.mediaStorage.usedPercent ?? null
  );
  readonly mediaUsedLabel = computed(() =>
    this.formatBytes(this.summary()?.kpis.mediaStorage.usedBytes ?? 0)
  );

  readonly campaignPacing = computed(
    () => this.summary()?.campaignPacing ?? ([] as DashboardCampaignPacingItem[])
  );

  readonly criticalAlerts = computed(
    () => this.summary()?.criticalAlerts ?? ([] as DashboardCriticalAlert[])
  );

  readonly activityLog = computed(() => this.summary()?.activity ?? []);

  readonly operational = computed(() => this.summary()?.operationalStatus);

  readonly proofOfPlayLastAt = computed(
    () => this.summary()?.proofOfPlay.lastReadyAt ?? null
  );

  readonly displayRows = computed(() => [...this.fleetItems()].slice(0, 8));

  readonly sparklinePathD = computed(() => {
    const pts = this.sparklineCounts();
    if (pts.length === 0) return '';
    const max = Math.max(...pts, 1);
    const w = 100;
    const h = 40;
    const step = w / Math.max(pts.length - 1, 1);
    const norm = pts.map((c, i) => {
      const x = i * step;
      const y = h - (c / max) * (h - 4) - 2;
      return { x, y };
    });
    const line = norm
      .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
      .join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    return area;
  });

  readonly sparklineStrokeD = computed(() => {
    const pts = this.sparklineCounts();
    if (pts.length === 0) return '';
    const max = Math.max(...pts, 1);
    const w = 100;
    const h = 40;
    const step = w / Math.max(pts.length - 1, 1);
    return pts
      .map((c, i) => {
        const x = i * step;
        const y = h - (c / max) * (h - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  });

  constructor() {
    interval(30_000)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.summaryApi.getSummary().pipe(
            catchError(() => of(null as DashboardSummaryResponse | null))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (res) => {
          if (res) this.summary.set(res);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  pacingBarWidth(c: DashboardCampaignPacingItem): number {
    if (c.tone === 'emerald') return 100;
    return Math.min(100, Math.max(0, c.pctOfTarget));
  }

  rowTitle(item: FleetStatusItem): string {
    return item.vehicleId || item.deviceId;
  }

  rowSubtitle(item: FleetStatusItem): string {
    const { lat, lng } = item.location;
    return `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
  }

  statusLabel(item: FleetStatusItem): string {
    const s = item.connectivity.status;
    if (s === 'online') return 'Online';
    if (s === 'offline') return 'Offline';
    return 'Maintenance';
  }

  statusDotClass(item: FleetStatusItem): string {
    const s = item.connectivity.status;
    if (s === 'online') return 'bg-primary';
    if (s === 'offline') return 'bg-red-600';
    return 'bg-slate-400';
  }

  layoutLabel(item: FleetStatusItem): string {
    if (item.playback.status === 'playing') {
      if (item.playback.currentCampaignId) {
        const id = item.playback.currentCampaignId;
        return id.length > 12 ? `${id.slice(0, 10)}…` : id;
      }
      return 'Full Screen Video';
    }
    if (item.playback.status === 'error') return 'Playback error';
    return 'Idle';
  }

  lastReportLabel(item: FleetStatusItem): string {
    return this.formatRelative(item.reportedAt);
  }

  lastReportTone(item: FleetStatusItem): string {
    const ageMs = Date.now() - new Date(item.reportedAt).getTime();
    if (ageMs > 120_000) return 'text-amber-600';
    return '';
  }

  formatImpressions(n: number): string {
    if (n >= 1_000_000) {
      return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    }
    if (n >= 1000) {
      return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    }
    return `${n}`;
  }

  formatAlertTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  formatActivityClock(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return '—';
    }
  }

  formatProofOfPlayRelative(iso: string | null): string {
    if (!iso) return 'No completed export yet';
    return `Last export ${this.formatRelative(iso)}`;
  }

  operationalDotClass(): string {
    const s = this.operational()?.state;
    if (s === 'critical') return 'bg-red-600';
    if (s === 'degraded') return 'bg-amber-500';
    return 'bg-primary animate-pulse';
  }

  go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  }

  private formatRelative(iso: string): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }
}
