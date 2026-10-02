import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { MessageService } from 'primeng/api';
import { MEDIA_CLIENT_LIMITS } from '../media-limits';
import { MediaUploadService } from '../services/media-upload.service';
import { MediaVfsUploadRunnerService } from '../services/media-vfs-upload-runner.service';

export interface UploadRow {
  id: string;
  name: string;
  progress: number;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  error?: string;
  validationStatus?: 'pending' | 'approved' | 'rejected' | 'warning';
}

@Component({
  selector: 'app-media-upload-dropzone',
  standalone: true,
  imports: [ButtonModule, ProgressBarModule],
  template: `
    <div
      class="border border-dashed border-surface-300 dark:border-surface-600 rounded-lg p-6 text-center bg-surface-0 dark:bg-surface-900"
      (dragover)="$event.preventDefault()"
      (drop)="onDrop($event)"
    >
      <p class="text-surface-700 dark:text-surface-200 mb-3">
        Drag files here or choose to upload (MP4, JPEG, PNG; max
        {{ limits.maxWidth }}×{{ limits.maxHeight }}, {{ mb }} MB)
      </p>
      <input
        #fileInput
        type="file"
        class="hidden"
        [accept]="accept"
        multiple
        (change)="onPick($event)"
      />
      <p-button
        label="Choose files"
        icon="pi pi-upload"
        (onClick)="fileInput.click()"
      />
      @if (rows().length > 0) {
        <div class="mt-6 space-y-3 text-left">
          @for (r of rows(); track r.id) {
            <div class="rounded border border-surface-200 dark:border-surface-700 p-3">
              <div class="flex justify-between gap-2 text-sm mb-1">
                <span class="truncate">{{ r.name }}</span>
                <span class="text-surface-500 shrink-0">{{ r.status }}</span>
              </div>
              <p-progressBar [value]="progressBarValue(r.progress)" [showValue]="false" />
              @if (r.error) {
                <p class="text-red-600 dark:text-red-400 text-xs mt-1">
                  {{ r.error }}
                </p>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class MediaUploadDropzoneComponent {
  private readonly upload = inject(MediaUploadService);
  private readonly runner = inject(MediaVfsUploadRunnerService);
  private readonly messages = inject(MessageService);

  @Input() folderId: string | null = null;
  @Output() uploadFinished = new EventEmitter<void>();

  readonly limits = MEDIA_CLIENT_LIMITS;
  readonly mb = Math.floor(MEDIA_CLIENT_LIMITS.maxBytes / 1_000_000);

  readonly accept = '.mp4,.jpg,.jpeg,.png';

  /** Immutable row updates avoid NG0100 after async upload/progress. */
  readonly rows = signal<UploadRow[]>([]);

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) {
      return;
    }
    void this.enqueue(Array.from(files));
    input.value = '';
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    const files = ev.dataTransfer?.files;
    if (!files?.length) {
      return;
    }
    void this.enqueue(Array.from(files));
  }

  progressBarValue(p: number): number {
    return Number.isFinite(p) && p >= 0 ? p : 0;
  }

  private async enqueue(files: File[]): Promise<void> {
    for (const file of files) {
      const pre = await this.upload.preflightAsync(file);
      if (!pre.ok) {
        this.messages.add({
          severity: 'warn',
          summary: 'File skipped',
          detail: `${file.name}: ${pre.reason}`,
        });
        continue;
      }
      const row: UploadRow = {
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        progress: 0,
        status: 'queued',
      };
      this.rows.update((xs) => [row, ...xs]);
      void this.runUpload(row, file);
    }
  }

  private patchRow(id: string, patch: Partial<UploadRow>): void {
    this.rows.update((xs) =>
      xs.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  private async runUpload(row: UploadRow, file: File): Promise<void> {
    this.patchRow(row.id, { status: 'uploading' });
    try {
      this.patchRow(row.id, { status: 'completing' });
      const done = await this.runner.uploadOneFile(file, this.folderId, (pct) => {
        this.patchRow(row.id, { progress: pct });
      });
      const vs = done['validationStatus'] as UploadRow['validationStatus'];
      this.patchRow(row.id, {
        progress: 100,
        status: 'done',
        ...(vs ? { validationStatus: vs } : {}),
      });
      this.messages.add({
        severity: 'success',
        summary: 'Upload complete',
        detail: file.name,
      });
      this.uploadFinished.emit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      this.patchRow(row.id, { status: 'error', error: msg });
      this.messages.add({
        severity: 'error',
        summary: 'Upload failed',
        detail: msg,
      });
    }
  }
}
