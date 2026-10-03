import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { switchMap } from 'rxjs';
import { toCents } from '@openad/domain';
import { CampaignsApiService, type GeoZoneRow } from './campaigns-api.service';

export type LayoutTemplateId = 'full' | 'split70' | 'ticker' | 'split50';

@Component({
  selector: 'app-campaign-wizard',
  standalone: true,
  imports: [
    DialogModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    FormsModule,
    SelectModule,
  ],
  templateUrl: './campaign-wizard.component.html',
  styleUrl: './campaign-wizard.component.css',
})
export class CampaignWizardComponent {
  private readonly api = inject(CampaignsApiService);
  private readonly messages = inject(MessageService);

  readonly completed = output<void>();

  protected readonly visible = signal(false);
  protected readonly step = signal(1);
  protected readonly saving = signal(false);
  protected readonly zones = signal<GeoZoneRow[]>([]);

  protected name = '';
  protected advertiser = '';
  protected priority = 1;
  protected layoutTemplateId: LayoutTemplateId = 'split70';

  protected startDate = '';
  protected endDate = '';
  protected dwellThresholdSeconds = 30;

  /** Mon–Fri morning rush (UTC), applied by preset */
  protected morningRushActive = true;

  protected file: File | null = null;
  protected selectedZoneId: string | null = null;

  /**
   * O formulario continua na unidade maior porque e o que o operador digita: `1000` querendo
   * mil, nao dez. A conversao para centavos acontece uma vez, na chamada da API, com
   * `toCents` — que arredonda, porque `0.05 * 100` em float nao e exatamente 5.
   */
  protected totalAmount = 1000;
  protected ratePerImpression = 0.05;
  protected readonly currency = 'USD';

  protected readonly steps = [
    { id: 1, label: '1. Identity' },
    { id: 2, label: '2. Scheduling' },
    { id: 3, label: '3. Content' },
    { id: 4, label: '4. Targeting' },
    { id: 5, label: '5. Review' },
  ] as const;

  /** Mobile mock: uppercase step name in progress strip */
  protected readonly mobileStepTitles = [
    '1. IDENTITY',
    '2. SCHEDULING',
    '3. CONTENT',
    '4. TARGETING',
    '5. REVIEW',
  ] as const;

  protected mobileStepTitle(): string {
    return this.mobileStepTitles[this.step() - 1] ?? '';
  }

  protected progressPercent(): number {
    return (this.step() / 5) * 100;
  }

  open(): void {
    this.resetForm();
    this.visible.set(true);
    this.loadZones();
  }

  protected close(): void {
    this.visible.set(false);
  }

  protected saveDraft(): void {
    this.messages.add({
      severity: 'info',
      summary: 'Save draft',
      detail: 'Saving drafts to the server will be available in a future update.',
    });
  }

  protected libraryComingSoon(): void {
    this.messages.add({
      severity: 'info',
      summary: 'Media library',
      detail: 'Selecting from the library will be available in a future update.',
    });
  }

  protected triggerPrimaryFileInput(): void {
    const el = document.getElementById(
      'cw-creative-file'
    ) as HTMLInputElement | null;
    el?.click();
  }

  protected nextStep(): void {
    if (this.step() < 5) {
      this.step.update((s) => s + 1);
    } else {
      this.submit();
    }
  }

  protected prevStep(): void {
    if (this.step() > 1) {
      this.step.update((s) => s - 1);
    }
  }

  protected applyMorningRush(): void {
    this.morningRushActive = true;
    this.messages.add({
      severity: 'success',
      summary: 'Preset applied',
      detail: 'Weekday 07:00–09:00 UTC window is selected.',
    });
  }

  protected clearSchedulePreset(): void {
    this.morningRushActive = false;
    this.messages.add({
      severity: 'info',
      summary: 'Preset cleared',
      detail: 'A default Mon–Fri window will still be used when you continue.',
    });
  }

  protected onFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    this.file = f ?? null;
    input.value = '';
  }

  protected selectedZoneName(): string {
    const z = this.zones().find((x) => x.zoneId === this.selectedZoneId);
    return z ? `${z.name} (${z.city})` : '—';
  }

  protected layoutLabel(): string {
    const labels: Record<LayoutTemplateId, string> = {
      full: 'Full Screen Video',
      split70: 'Split Screen (70/30)',
      ticker: 'Video with Bottom Ticker',
      split50: 'Split Screen (50/50)',
    };
    return labels[this.layoutTemplateId];
  }

  protected submit(): void {
    const f = this.file;
    const zid = this.selectedZoneId;
    if (!this.name.trim() || !this.advertiser.trim()) {
      this.messages.add({
        severity: 'warn',
        summary: 'Missing identity',
        detail: 'Enter a campaign name and client name.',
      });
      this.step.set(1);
      return;
    }
    if (!this.startDate || !this.endDate) {
      this.messages.add({
        severity: 'warn',
        summary: 'Schedule required',
        detail: 'Choose a start and end date.',
      });
      this.step.set(2);
      return;
    }
    if (!f) {
      this.messages.add({
        severity: 'warn',
        summary: 'Creative required',
        detail: 'Upload an image or video file.',
      });
      this.step.set(3);
      return;
    }
    if (!zid) {
      this.messages.add({
        severity: 'warn',
        summary: 'Targeting required',
        detail: 'Select a geo zone.',
      });
      this.step.set(4);
      return;
    }

    const start = new Date(`${this.startDate}T00:00:00.000Z`);
    const end = new Date(`${this.endDate}T23:59:59.999Z`);
    if (end.getTime() <= start.getTime()) {
      this.messages.add({
        severity: 'warn',
        summary: 'Invalid range',
        detail: 'End date must be after the start date.',
      });
      this.step.set(2);
      return;
    }

    const timeWindows = this.morningRushActive
      ? [
          {
            daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const,
            startTime: '07:00',
            endTime: '09:00',
            timezone: 'UTC',
          },
        ]
      : [
          {
            daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const,
            startTime: '00:00',
            endTime: '23:59',
            timezone: 'UTC',
          },
        ];

    this.saving.set(true);
    const mime = f.type || 'image/png';

    this.api
      .createCampaign({
        name: this.name.trim(),
        advertiserName: this.advertiser.trim(),
        priority: this.priority,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        budget: {
          totalAmountCents: toCents(this.totalAmount),
          currency: this.currency,
          ratePerImpressionCents: toCents(this.ratePerImpression),
        },
      })
      .pipe(
        switchMap((c) => {
          const cid = c.campaignId;
          return this.api.uploadAsset(cid, f, mime).pipe(
            switchMap((up) =>
              this.api.createRule(cid, {
                assetId: up.assetId,
                geoZoneIds: [zid],
                timeWindows: timeWindows.map((tw) => ({
                  daysOfWeek: [...tw.daysOfWeek],
                  startTime: tw.startTime,
                  endTime: tw.endTime,
                  timezone: tw.timezone,
                })),
                dwellThresholdSeconds: this.dwellThresholdSeconds,
                priority: null,
              })
            ),
            switchMap(() =>
              this.api.patchCampaignStatus(cid, { status: 'active' })
            )
          );
        })
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.close();
          this.messages.add({
            severity: 'success',
            summary: 'Campaign activated',
          });
          this.completed.emit();
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }

  private resetForm(): void {
    this.step.set(1);
    this.name = 'Morning promo';
    this.advertiser = 'Demo brand';
    this.priority = 1;
    this.layoutTemplateId = 'split70';
    const start = new Date();
    const end = new Date(start.getTime() + 86400000 * 30);
    this.startDate = start.toISOString().slice(0, 10);
    this.endDate = end.toISOString().slice(0, 10);
    this.dwellThresholdSeconds = 30;
    this.morningRushActive = true;
    this.file = null;
    this.selectedZoneId = null;
    this.totalAmount = 1000;
    this.ratePerImpression = 0.05;
  }

  private loadZones(): void {
    this.api.listGeoZones().subscribe({
      next: (res) => this.zones.set(res.data),
      error: () => this.zones.set([]),
    });
  }
}
