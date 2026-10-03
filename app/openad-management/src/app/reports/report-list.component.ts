import { CentsPipe } from '../shared/cents.pipe';
import { Component, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import type { ReportJobStatus } from '@openad/api-contracts';
import type { ReportFormat } from './report-request-form.component';
import { ReportStatusPollerComponent } from './report-status-poller.component';

export interface ReportSessionRow {
  reportJobId: string;
  campaignName: string;
  format: ReportFormat;
  status: ReportJobStatus['status'];
  downloadUrl: string | null;
  summary: ReportJobStatus['summary'] | null;
}

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [
    CentsPipe,
    TableModule,
    TagModule,
    ButtonModule,
    ReportStatusPollerComponent,
  ],
  template: `
    <div
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900/40"
    >
      <h2 class="app-font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
        Reports (this session)
      </h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Jobs you requested stay listed until you refresh the page.
      </p>

      <p-table
        data-testid="reports-table"
        [value]="rows()"
        [rowHover]="true"
        styleClass="mt-4 p-datatable-sm"
        [tableStyle]="{ 'min-width': '100%' }"
      >
        <ng-template #header>
          <tr>
            <th>Job</th>
            <th>Campaign</th>
            <th>Format</th>
            <th>Status</th>
            <th>Summary</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            <td class="font-mono text-xs">{{ row.reportJobId.slice(0, 8) }}…</td>
            <td>{{ row.campaignName }}</td>
            <td class="uppercase">{{ row.format }}</td>
            <td>
              <p-tag
                [severity]="
                  row.status === 'ready'
                    ? 'success'
                    : row.status === 'failed'
                      ? 'danger'
                      : 'warn'
                "
                [value]="row.status"
              />
              <app-report-status-poller [status]="row.status" />
            </td>
            <td class="max-w-[220px] text-xs text-slate-600 dark:text-slate-400">
              @if (row.summary) {
                <span
                  >{{ row.summary.totalImpressions }} imps ·
                  {{ row.summary.totalBillableValueCents | cents }}
                  {{ row.summary.currency }}</span
                >
              } @else {
                —
              }
            </td>
            <td>
              @if (row.downloadUrl) {
                <a
                  data-testid="reports-download-link"
                  [href]="row.downloadUrl"
                  target="_blank"
                  rel="noopener"
                >
                  <p-button label="Download" icon="pi pi-download" [outlined]="true" size="small" />
                </a>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="6" class="text-center text-slate-500">No reports yet.</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class ReportListComponent {
  readonly rows = input<ReportSessionRow[]>([]);
}
