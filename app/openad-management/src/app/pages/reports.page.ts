import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { ReportJobStatus } from '@openad/api-contracts';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Subscription, interval } from 'rxjs';
import { CampaignsApiService, type CampaignRow } from '../campaigns/campaigns-api.service';
import {
  ReportListComponent,
  type ReportSessionRow,
} from '../reports/report-list.component';
import {
  ReportRequestFormComponent,
  type ReportFormat,
} from '../reports/report-request-form.component';
import { ReportsApiService } from '../reports/reports-api.service';

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    ReportRequestFormComponent,
    ReportListComponent,
  ],
  template: `
    <div class="space-y-8 p-4 md:p-6">
      <div>
        <h1
          class="app-font-display text-2xl font-semibold text-slate-900 dark:text-slate-100"
        >
          Reports
        </h1>
        <p class="mt-1 text-slate-600 dark:text-slate-400">
          Proof-of-play exports and impression drill-down (US4).
        </p>
      </div>

      <app-report-request-form
        [campaigns]="campaigns()"
        [loading]="submitting()"
        (submitRequested)="onRequest($event)"
      />

      <app-report-list [rows]="rows()" />

      <div
        class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900/40"
      >
        <h2
          class="app-font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Impression drill-down
        </h2>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Enter an impression <span class="font-mono">eventId</span> to open the detail view with map.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <input
            pInputText
            type="text"
            class="min-w-[280px] flex-1 font-mono text-sm"
            placeholder="00000000-0000-4000-8000-000000000000"
            [(ngModel)]="impressionEventId"
            data-testid="reports-impression-event-input"
          />
          <p-button
            label="View impression"
            icon="pi pi-map"
            [disabled]="!impressionEventId.trim()"
            (onClick)="goImpression()"
            data-testid="reports-impression-open"
          />
        </div>
      </div>
    </div>
  `,
})
export class ReportsPage implements OnInit, OnDestroy {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly campaignsApi = inject(CampaignsApiService);
  private readonly router = inject(Router);

  protected readonly campaigns = signal<CampaignRow[]>([]);
  protected readonly rows = signal<ReportSessionRow[]>([]);
  protected readonly submitting = signal(false);
  protected impressionEventId = '';

  private pollSub: Subscription | null = null;

  ngOnInit(): void {
    this.campaignsApi.listCampaigns(1, 200).subscribe({
      next: (r) => this.campaigns.set(r.data),
      error: () => this.campaigns.set([]),
    });

    this.pollSub = interval(10_000).subscribe(() => this.refreshPendingJobs());
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  protected onRequest(body: { campaignId: string; format: ReportFormat }): void {
    this.submitting.set(true);
    this.reportsApi
      .requestProofOfPlay({
        campaignId: body.campaignId,
        format: body.format,
      })
      .subscribe({
        next: (acc) => {
          const camp = this.campaigns().find(
            (c) => c.campaignId === body.campaignId
          );
          const row: ReportSessionRow = {
            reportJobId: acc.reportJobId,
            campaignName: camp?.name ?? body.campaignId,
            format: body.format,
            status: acc.status,
            downloadUrl: null,
            summary: null,
          };
          this.rows.update((list) => [row, ...list]);
          this.submitting.set(false);
          this.refreshPendingJobs();
        },
        error: () => {
          this.submitting.set(false);
        },
      });
  }

  private refreshPendingJobs(): void {
    const pending = this.rows().filter(
      (r) => r.status === 'queued' || r.status === 'processing'
    );
    for (const row of pending) {
      this.reportsApi.getJob(row.reportJobId).subscribe({
        next: (st) => this.mergeRow(row.reportJobId, st),
        error: () => {
          /* keep row; next poll retries */
        },
      });
    }
  }

  private mergeRow(jobId: string, st: ReportJobStatus): void {
    this.rows.update((list) =>
      list.map((r) =>
        r.reportJobId === jobId
          ? {
              ...r,
              status: st.status,
              downloadUrl: st.downloadUrl,
              summary: st.summary,
            }
          : r
      )
    );
  }

  protected goImpression(): void {
    const id = this.impressionEventId.trim();
    if (!id) return;
    void this.router.navigate(['/reports/impression', id]);
  }
}
