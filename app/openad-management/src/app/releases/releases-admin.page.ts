import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DrawerModule } from 'primeng/drawer';
import { FileUpload, FileUploadModule } from 'primeng/fileupload';
import type { FileSelectEvent } from 'primeng/types/fileupload';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PanelModule } from 'primeng/panel';
import { ProgressBarModule } from 'primeng/progressbar';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { forkJoin } from 'rxjs';
import type { DeviceGroupResponse } from '@openad/api-contracts';
import { DeviceGroupsPortalService } from '../device-groups/device-groups.service';
import { ProvisioningQrService } from './provisioning-qr.service';
import { ReleasesApiService, type AppReleaseDto, type RolloutDto } from './releases-api.service';
import { RolloutConfigComponent } from './rollout-config.component';
import { ReleasesOperatorToolsComponent } from './releases-operator-tools.component';

type PostUploadChoice = 'draft' | 'staged' | 'stable';

function formatDisplayVersion(ver: string | undefined | null): string {
  if (!ver?.trim()) {
    return '';
  }
  const t = ver.trim();
  return t.toLowerCase().startsWith('v') ? t : `v${t}`;
}

@Component({
  selector: 'app-releases-admin-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToastModule,
    ButtonModule,
    TableModule,
    TagModule,
    CardModule,
    DrawerModule,
    FileUploadModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    SliderModule,
    RadioButtonModule,
    ProgressBarModule,
    PanelModule,
    RolloutConfigComponent,
    ReleasesOperatorToolsComponent,
  ],
  providers: [MessageService],
  templateUrl: './releases-admin.page.html',
})
export class ReleasesAdminPage implements OnInit {
  private readonly api = inject(ReleasesApiService);
  private readonly qr = inject(ProvisioningQrService);
  private readonly groupsApi = inject(DeviceGroupsPortalService);
  private readonly messages = inject(MessageService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('apkFileUpload') private apkFileUpload?: FileUpload;

  protected readonly ledgerAnchorId = 'device-app-releases-ledger';
  protected readonly maxApkFileBytes = 500_000_000;

  protected releases: AppReleaseDto[] = [];
  protected rollouts: RolloutDto[] = [];
  protected deviceGroups: DeviceGroupResponse[] = [];
  protected deviceGroupOptions: { label: string; value: string }[] = [];
  protected loading = false;
  protected versionIdentifier = '';
  protected buildNumber: number | null = null;
  protected file: File | null = null;
  protected releaseNotes = '';
  protected stableEmptyMessage: string | null = null;
  protected latestStableVersion: string | null = null;
  protected qrDataUrl: string | null = null;
  protected pdfLoading = false;
  protected uploadDrawerVisible = false;
  protected uploading = false;
  protected postUploadChoice: PostUploadChoice = 'draft';
  protected lastUploadedRelease: AppReleaseDto | null = null;
  protected postUploadBusy = false;
  protected stagedFleetPercent = 15;
  protected stagedGroupId = '';

  protected metricTotalOnLatest: number | null = null;
  protected metricStagedWaves: number | null = null;
  protected metricPending: number | null = null;
  protected revokingId: string | null = null;

  ngOnInit(): void {
    this.loadDeviceGroups();
    this.refreshList();
    void this.refreshQr();
  }

  private loadDeviceGroups(): void {
    this.groupsApi.getGroups(1, 200).subscribe({
      next: (p) => {
        this.deviceGroups = p.data ?? [];
        this.deviceGroupOptions = [
          { label: 'All devices (no group filter)', value: '' },
          ...this.deviceGroups.map((g) => ({ label: `${g.name} · ${g.memberCount} devices`, value: g.groupId })),
        ];
        this.cdr.detectChanges();
      },
      error: () => {
        this.deviceGroupOptions = [{ label: 'All devices (no group filter)', value: '' }];
        this.cdr.detectChanges();
      },
    });
  }

  refreshList(): void {
    this.loading = true;
    this.cdr.detectChanges();
    forkJoin({
      releases: this.api.listReleases(),
      rollouts: this.api.listRollouts(),
      metrics: this.api.getMdmMetrics(),
    }).subscribe({
      next: ({ releases, rollouts, metrics }) => {
        this.releases = [...releases].sort(
          (a, b) =>
            (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
            (a.createdAt ? new Date(a.createdAt).getTime() : 0)
        );
        this.rollouts = rollouts;
        this.loading = false;
        this.metricTotalOnLatest = metrics.totalOnLatest;
        this.metricPending = metrics.pendingNotOnLatest;
        this.metricStagedWaves = metrics.openRolloutWaves;
        this.syncLatestVersionLabel(metrics.latestStableVersion);
        this.cdr.detectChanges();
      },
      error: (e: HttpErrorResponse) => {
        this.loading = false;
        this.messages.add({
          severity: 'error',
          summary: 'List failed',
          detail: e.error?.message ?? e.message,
        });
        this.cdr.detectChanges();
      },
    });
  }

  private syncLatestVersionLabel(fromMetrics: string | null): void {
    const v =
      fromMetrics ||
      this.releases.find((r) => r.isLatestStable)?.versionIdentifier ||
      null;
    this.latestStableVersion = v ? formatDisplayVersion(v) : null;
  }

  onApkSelect(event: FileSelectEvent): void {
    const f = event.currentFiles?.[0] ?? event.files?.[0];
    this.file = f ?? null;
  }

  onApkRemove(): void {
    this.file = null;
  }

  openUploadDrawer(): void {
    this.resetUploadState();
    this.uploadDrawerVisible = true;
  }

  closeUploadDrawer(): void {
    this.uploadDrawerVisible = false;
  }

  onUploadDrawerHide(): void {
    this.resetUploadState();
  }

  private resetUploadState(): void {
    this.versionIdentifier = '';
    this.buildNumber = null;
    this.file = null;
    this.releaseNotes = '';
    this.lastUploadedRelease = null;
    this.postUploadChoice = 'draft';
    this.postUploadBusy = false;
    this.stagedFleetPercent = 15;
    this.stagedGroupId = '';
    this.apkFileUpload?.clear();
    this.cdr.detectChanges();
  }

  upload(): void {
    if (this.uploading) {
      return;
    }
    if (!this.file || !this.versionIdentifier.trim()) {
      this.messages.add({ severity: 'warn', summary: 'Need APK file and version' });
      return;
    }
    this.uploading = true;
    this.cdr.detectChanges();
    this.api
      .uploadRelease({
        file: this.file,
        versionIdentifier: this.versionIdentifier.trim(),
        buildNumber: this.buildNumber ?? undefined,
        releaseNotes: this.releaseNotes.trim() || undefined,
      })
      .subscribe({
        next: (rel) => {
          this.uploading = false;
          this.messages.add({ severity: 'success', summary: 'Release uploaded' });
          this.lastUploadedRelease = rel;
          this.postUploadChoice = 'draft';
          this.cdr.detectChanges();
          this.refreshList();
        },
        error: (e: HttpErrorResponse) => {
          this.uploading = false;
          this.messages.add({
            severity: 'error',
            summary: 'Upload failed',
            detail: e.error?.message ?? e.message,
          });
          this.cdr.detectChanges();
        },
      });
  }

  applyPostUploadAction(): void {
    const rel = this.lastUploadedRelease;
    if (!rel?._id) {
      this.messages.add({ severity: 'warn', summary: 'Upload a release first' });
      return;
    }
    this.postUploadBusy = true;
    this.cdr.detectChanges();

    if (this.postUploadChoice === 'draft') {
      this.postUploadBusy = false;
      this.closeUploadDrawer();
      this.refreshList();
      this.messages.add({ severity: 'info', summary: 'Saved as draft', detail: 'Promote it later from this page.' });
      this.cdr.detectChanges();
      return;
    }

    if (this.postUploadChoice === 'stable') {
      this.api.publishStable(rel._id).subscribe({
        next: () => {
          this.postUploadBusy = false;
          this.messages.add({ severity: 'success', summary: 'Latest stable updated' });
          void this.refreshQr();
          this.closeUploadDrawer();
          this.refreshList();
          this.cdr.detectChanges();
        },
        error: (e: HttpErrorResponse) => {
          this.postUploadBusy = false;
          this.messages.add({
            severity: 'error',
            summary: 'Publish failed',
            detail: e.error?.message ?? e.message,
          });
          this.cdr.detectChanges();
        },
      });
      return;
    }

    if (this.postUploadChoice === 'staged') {
      const groupIds = this.stagedGroupId.trim() ? [this.stagedGroupId.trim()] : [];
      this.api
        .createRollout(rel._id, { deviceGroupIds: groupIds, percentage: this.stagedFleetPercent })
        .subscribe({
          next: (ro) => {
            this.api.patchRollout(ro._id, 'active').subscribe({
              next: () => {
                this.postUploadBusy = false;
                this.messages.add({
                  severity: 'success',
                  summary: 'Staged rollout started',
                  detail: `Targeting ${this.stagedFleetPercent}% of eligible devices.${
                    groupIds.length ? ` Groups: ${groupIds.length}.` : ' No group filter.'
                  }`,
                });
                this.closeUploadDrawer();
                this.refreshList();
                this.cdr.detectChanges();
              },
              error: (e: HttpErrorResponse) => {
                this.postUploadBusy = false;
                this.messages.add({
                  severity: 'error',
                  summary: 'Could not activate rollout',
                  detail: e.error?.message ?? e.message,
                });
                this.cdr.detectChanges();
              },
            });
          },
          error: (e: HttpErrorResponse) => {
            this.postUploadBusy = false;
            this.messages.add({
              severity: 'error',
              summary: 'Staged rollout failed',
              detail: e.error?.message ?? e.message,
            });
            this.cdr.detectChanges();
          },
        });
    }
  }

  printQr(): void {
    if (!this.qrDataUrl) {
      return;
    }
    const w = window.open('', '_blank', 'noopener,width=520,height=680');
    if (!w) {
      this.messages.add({ severity: 'warn', summary: 'Allow pop-ups to print the QR' });
      return;
    }
    w.document.write(
      `<!DOCTYPE html><html><head><title>Provisioning QR</title></head><body style="font-family:system-ui;margin:24px;text-align:center">
      <h1 style="font-size:18px;margin:0 0 16px">OpenAd · Device owner provisioning</h1>
      <img src="${this.qrDataUrl}" alt="Provisioning QR" style="max-width:100%;height:auto"/>
      <p style="color:#555;font-size:14px">Scan on a new tablet during Android Enterprise setup.</p>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200))</script>
    </body></html>`
    );
    w.document.close();
  }

  downloadPdf(): void {
    this.pdfLoading = true;
    this.cdr.detectChanges();
    this.api.downloadStableCheatSheetPdf().subscribe({
      next: (blob) => {
        this.pdfLoading = false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'openad-provisioning-qr.pdf';
        a.click();
        URL.revokeObjectURL(url);
        this.cdr.detectChanges();
      },
      error: (e: HttpErrorResponse) => {
        this.pdfLoading = false;
        this.messages.add({
          severity: 'error',
          summary: 'PDF download failed',
          detail: e.error?.message ?? e.message,
        });
        this.cdr.detectChanges();
      },
    });
  }

  async refreshQr(): Promise<void> {
    this.api.recordQrRegenerate().subscribe({ error: () => undefined });
    this.api.getStableManifestPublic().subscribe({
      next: async (m: unknown) => {
        const manifest = m as { latest?: { downloadUrl?: string }; message?: string };
        const downloadUrl = manifest.latest?.downloadUrl;
        if (!downloadUrl) {
          this.qrDataUrl = null;
          this.stableEmptyMessage = manifest.message ?? 'No stable release published';
          this.cdr.detectChanges();
          return;
        }
        this.stableEmptyMessage = null;
        const url = downloadUrl;
        const payload = this.qr.buildProvisioningPayload({ apkDownloadUrl: url });
        this.qrDataUrl = await this.qr.toQrDataUrl(payload);
        this.cdr.detectChanges();
      },
      error: () => {
        this.qrDataUrl = null;
        this.stableEmptyMessage = 'Cannot load stable manifest';
        this.cdr.detectChanges();
      },
    });
  }

  formatReach(r: AppReleaseDto): string {
    if (r.installedCount == null) {
      return '—';
    }
    if (r.installedCount === 0) {
      return '0 devices';
    }
    if (r.installedCount === 1) {
      return '1 device';
    }
    return `Installed on ${r.installedCount} devices`;
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  isToday(d: Date): boolean {
    const t = new Date();
    return (
      d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate()
    );
  }

  displayDateForRow(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    if (this.isToday(d)) {
      return `Today, ${d.toLocaleTimeString(undefined, { timeStyle: 'short' })}`;
    }
    return this.formatDate(iso);
  }

  versionCellClass(r: AppReleaseDto): string {
    return r.status === 'revoked' ? 'line-through opacity-70' : 'font-mono';
  }

  displayVersion(v: string): string {
    return formatDisplayVersion(v);
  }

  rolloutForRelease(releaseId: string | undefined): RolloutDto | undefined {
    if (!releaseId) {
      return undefined;
    }
    return this.rollouts.find(
      (ro) =>
        ro.releaseId === releaseId &&
        (ro.status === 'active' || ro.status === 'draft' || ro.status === 'paused')
    );
  }

  showRolloutColumn(r: AppReleaseDto): boolean {
    if (r.isLatestStable) {
      return true;
    }
    if (r.hasStagedRollout) {
      return true;
    }
    if (this.rolloutForRelease(r._id) !== undefined) {
      return true;
    }
    return (r.status ?? '').toLowerCase() === 'approved';
  }

  rolloutLabel(r: AppReleaseDto, ro: RolloutDto | undefined): string {
    if (r.isLatestStable) {
      return 'Global (100%)';
    }
    if (ro) {
      const p = ro.percentage;
      if (p == null) {
        return 'Staged (no % cap)';
      }
      return `${p}% of fleet (cap)`;
    }
    if (!r.isLatestStable && (r.status ?? '') === 'approved') {
      return 'Approved (no rollout record)';
    }
    return '—';
  }

  progressValue(r: AppReleaseDto, ro: RolloutDto | undefined): number {
    if (r.isLatestStable) {
      return 100;
    }
    if (ro?.percentage != null) {
      return Math.min(100, Math.max(0, ro.percentage));
    }
    return 0;
  }

  shouldShowProgress(r: AppReleaseDto, ro: RolloutDto | undefined): boolean {
    return !r.isLatestStable && ro != null && ro.percentage != null;
  }

  protected statusLabel(r: AppReleaseDto): string {
    if (r.isLatestStable) {
      return 'Latest Stable';
    }
    if (r.status === 'revoked') {
      return 'Archived';
    }
    if (r.hasStagedRollout) {
      return 'Staged';
    }
    if (r.status === 'uploaded') {
      return 'Draft';
    }
    if (r.status === 'approved') {
      return 'Prior release';
    }
    return r.status ?? 'Unknown';
  }

  protected statusSeverity(
    r: AppReleaseDto
  ): 'success' | 'info' | 'warn' | 'secondary' | 'contrast' | 'danger' {
    if (r.isLatestStable) {
      return 'success';
    }
    if (r.status === 'revoked') {
      return 'contrast';
    }
    if (r.hasStagedRollout) {
      return 'warn';
    }
    if (r.status === 'uploaded') {
      return 'secondary';
    }
    if (r.status === 'approved') {
      return 'info';
    }
    return 'info';
  }

  canRevoke(r: AppReleaseDto): boolean {
    if (r.status === 'revoked' || r.isLatestStable) {
      return false;
    }
    return true;
  }

  revoke(r: AppReleaseDto): void {
    if (!this.canRevoke(r) || this.revokingId) {
      return;
    }
    this.revokingId = r._id;
    this.cdr.detectChanges();
    this.api.revokeRelease(r._id).subscribe({
      next: () => {
        this.revokingId = null;
        this.messages.add({ severity: 'success', summary: 'Release retired (archived)' });
        this.refreshList();
        void this.refreshQr();
        this.cdr.detectChanges();
      },
      error: (e: HttpErrorResponse) => {
        this.revokingId = null;
        this.messages.add({
          severity: 'error',
          summary: 'Could not retire release',
          detail: e.error?.message ?? e.message,
        });
        this.cdr.detectChanges();
      },
    });
  }
}
