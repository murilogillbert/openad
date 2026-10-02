import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import type { PendingPairingDevice } from '@openad/api-contracts';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { formatRelativeTime } from '../inventory/inventory-relative-time';
import { OperationsTelemetryService } from '../operations/operations-telemetry.service';
import { PairingApiService } from './pairing-api.service';

@Component({
  standalone: true,
  selector: 'app-pending-pairing',
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    ButtonModule,
    DialogModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
  ],
  templateUrl: './pending-pairing.component.html',
  styleUrl: './pending-pairing.component.css',
})
export class PendingPairingComponent implements OnInit {
  private readonly pairingApi = inject(PairingApiService);
  private readonly opsTelemetry = inject(OperationsTelemetryService);

  protected readonly rows = signal<PendingPairingDevice[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly secretDialog = signal(false);
  protected readonly lastSecret = signal<{
    displayCode: string;
    expiresAt: string;
  } | null>(null);

  protected readonly search = signal('');

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rows = this.rows();
    if (!q) {
      return rows;
    }
    return rows.filter(
      (r) =>
        r.deviceId.toLowerCase().includes(q) ||
        r.serialNumber.toLowerCase().includes(q)
    );
  });

  protected readonly kpis = computed(() => {
    const rows = this.rows();
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let recent24h = 0;
    let olderThan24h = 0;
    for (const r of rows) {
      const t = new Date(r.createdAt).getTime();
      if (Number.isNaN(t)) {
        continue;
      }
      if (now - t <= dayMs) {
        recent24h++;
      } else {
        olderThan24h++;
      }
    }
    return { total: rows.length, recent24h, olderThan24h };
  });

  protected readonly oldestWaitLabel = computed(() => {
    const rows = this.rows();
    if (!rows.length) {
      return '—';
    }
    let minT = Infinity;
    for (const r of rows) {
      const t = new Date(r.createdAt).getTime();
      if (!Number.isNaN(t)) {
        minT = Math.min(minT, t);
      }
    }
    if (minT === Infinity) {
      return '—';
    }
    return formatRelativeTime(new Date(minT).toISOString());
  });

  protected readonly displayKpis = computed(() => {
    const live = this.opsTelemetry.snapshot()?.pendingPairing;
    if (live) {
      return {
        total: live.inQueue,
        recent24h: live.last24h,
        olderThan24h: live.olderThan24h,
      };
    }
    return this.kpis();
  });

  protected readonly displayOldestWaitLabel = computed(() => {
    const pending = this.opsTelemetry.snapshot()?.pendingPairing;
    if (pending) {
      return pending.oldestWaitLabel ?? '—';
    }
    return this.oldestWaitLabel();
  });

  ngOnInit(): void {
    this.refresh();
  }

  protected onSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.search.set(v);
  }

  protected relative(iso: string): string {
    return formatRelativeTime(iso);
  }

  protected refresh(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.pairingApi.listPending().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
        this.loadError.set('Could not load pending devices.');
      },
    });
  }

  protected generateFor(row: PendingPairingDevice): void {
    this.pairingApi.generateSecret(row.deviceId).subscribe({
      next: (sec) => {
        this.lastSecret.set(sec);
        this.secretDialog.set(true);
      },
      error: () => {
        this.loadError.set('Failed to generate pairing secret.');
      },
    });
  }
}
