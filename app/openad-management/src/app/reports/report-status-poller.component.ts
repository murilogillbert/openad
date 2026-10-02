import { Component, input } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';
import type { ReportJobStatus } from '@openad/api-contracts';

/**
 * Visual indicator while a report job is not terminal (parent handles HTTP polling).
 */
@Component({
  selector: 'app-report-status-poller',
  standalone: true,
  imports: [ProgressBarModule],
  template: `
    @if (status() === 'queued' || status() === 'processing') {
      <p-progressBar mode="indeterminate" styleClass="mt-2 h-1" />
    }
  `,
})
export class ReportStatusPollerComponent {
  readonly status = input<ReportJobStatus['status']>('queued');
}
