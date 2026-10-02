import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import type { CampaignRow } from '../campaigns/campaigns-api.service';

export type ReportFormat = 'json' | 'csv' | 'pdf';

@Component({
  selector: 'app-report-request-form',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
  ],
  template: `
    <div
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900/40"
    >
      <h2 class="app-font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
        Request proof-of-play
      </h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Choose a campaign and format. The job appears below; status updates every 10 seconds.
      </p>

      <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-end">
        <div class="min-w-[240px] flex-1">
          <label
            for="reports-campaign-select"
            class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >Campaign</label
          >
          <p-select
            inputId="reports-campaign-select"
            data-testid="reports-campaign-select"
            [options]="campaignOptions()"
            [(ngModel)]="selectedCampaignId"
            optionLabel="label"
            optionValue="value"
            placeholder="Select campaign"
            class="w-full"
            [filter]="true"
            [showClear]="true"
            [disabled]="loading()"
          />
        </div>
        <div>
          <label
            for="reports-format-select"
            class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >Format</label
          >
          <p-selectButton
            inputId="reports-format-select"
            data-testid="reports-format-select"
            [options]="formatOptions"
            [(ngModel)]="format"
            [disabled]="loading()"
          />
        </div>
        <p-button
          data-testid="reports-submit"
          label="Generate report"
          icon="pi pi-file-export"
          [loading]="loading()"
          [disabled]="!selectedCampaignId || loading()"
          (onClick)="onSubmit()"
        />
      </div>
    </div>
  `,
})
export class ReportRequestFormComponent {
  readonly campaigns = input<CampaignRow[]>([]);
  readonly loading = input(false);

  readonly submitRequested = output<{
    campaignId: string;
    format: ReportFormat;
  }>();

  protected selectedCampaignId: string | null = null;
  protected format: ReportFormat = 'pdf';

  protected readonly formatOptions = [
    { label: 'PDF', value: 'pdf' as const },
    { label: 'CSV', value: 'csv' as const },
    { label: 'JSON', value: 'json' as const },
  ];

  protected campaignOptions(): { label: string; value: string }[] {
    return this.campaigns().map((c) => ({
      label: `${c.name} (${c.advertiserName})`,
      value: c.campaignId,
    }));
  }

  protected onSubmit(): void {
    if (!this.selectedCampaignId) return;
    this.submitRequested.emit({
      campaignId: this.selectedCampaignId,
      format: this.format,
    });
  }
}
