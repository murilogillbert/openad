import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { DividerModule } from 'primeng/divider';
import { ImageModule } from 'primeng/image';
import { MediaValidationBadgeComponent } from './media-validation-badge.component';
import { MediaAssetActionsComponent } from './media-asset-actions.component';

@Component({
  selector: 'app-media-inspector-panel',
  standalone: true,
  imports: [
    DecimalPipe,
    DividerModule,
    ImageModule,
    MediaValidationBadgeComponent,
    MediaAssetActionsComponent,
  ],
  template: `
    @if (detail()) {
      @let d = detail()!;
      <div class="flex min-h-0 h-full flex-col text-sm text-color">
        <div
          class="shrink-0 w-full overflow-hidden bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700"
        >
          @if (previewUrl()) {
            @if (isVideo()) {
              <video
                class="max-h-[min(50vh,28rem)] w-full object-contain"
                [src]="previewUrl()!"
                controls
                playsinline
                preload="metadata"
              ></video>
            } @else {
              <p-image
                [src]="previewUrl()!"
                [alt]="str(d, 'filename')"
                [preview]="true"
                [appendTo]="'body'"
                styleClass="block w-full"
                imageClass="max-h-[min(50vh,28rem)] w-full object-contain"
              />
            }
          } @else {
            <div
              class="flex aspect-video items-center justify-center text-muted-color text-xs min-h-[8rem]"
            >
              No preview
            </div>
          }
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
          <div>
            <div class="text-muted-color text-[10px] uppercase tracking-widest font-bold mb-1">
              File
            </div>
            <div class="font-headline font-bold text-base break-all leading-snug">
              {{ str(d, 'filename') }}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div
              class="bg-surface-100 dark:bg-surface-800/80 rounded-lg p-3 border border-surface-200/60 dark:border-surface-700"
            >
              <div class="text-[10px] text-muted-color mb-1">Size</div>
              <div class="font-semibold">{{ num(d, 'fileSize') | number }} B</div>
            </div>
            <div
              class="bg-surface-100 dark:bg-surface-800/80 rounded-lg p-3 border border-surface-200/60 dark:border-surface-700"
            >
              <div class="text-[10px] text-muted-color mb-1">Refs</div>
              <div class="font-semibold">{{ num(d, 'referenceCount') }}</div>
            </div>
          </div>
          <div>
            <div class="text-muted-color text-[10px] uppercase tracking-widest font-bold mb-2">
              Validation
            </div>
            <app-media-validation-badge [status]="asValStatus(d, 'validationStatus')" />
          </div>
          <div>
            <div class="text-muted-color text-[10px] uppercase tracking-widest font-bold mb-1">
              Hash
            </div>
            <div class="font-mono text-xs break-all text-muted-color leading-relaxed">
              {{ str(d, 'hash') }}
            </div>
          </div>
          <p-divider />
          <app-media-asset-actions
            [mediaId]="str(d, 'mediaId')"
            [folderId]="folderId()"
            [filename]="str(d, 'filename')"
            (changed)="reload.emit()"
          />
        </div>
      </div>
    } @else {
      <p class="text-muted-color text-sm m-0 px-3 py-4">Loading…</p>
    }
  `,
})
export class MediaInspectorPanelComponent {
  readonly detail = input<Record<string, unknown> | null>(null);
  readonly folderId = input.required<string>();
  readonly reload = output<void>();

  readonly previewUrl = computed(() => {
    const d = this.detail();
    const u = d?.['previewUrl'];
    return typeof u === 'string' && u.length > 0 ? u : null;
  });

  readonly isVideo = computed(() => {
    const d = this.detail();
    const m = d?.['mimeType'];
    return typeof m === 'string' && m.toLowerCase().startsWith('video/');
  });

  str(row: Record<string, unknown>, k: string): string {
    const v = row[k];
    return typeof v === 'string' ? v : v != null ? String(v) : '—';
  }

  num(row: Record<string, unknown>, k: string): number {
    const v = row[k];
    return typeof v === 'number' ? v : 0;
  }

  asValStatus(
    row: Record<string, unknown>,
    k: string
  ): MediaValidationBadgeComponent['status'] {
    const v = row[k];
    if (
      v === 'pending' ||
      v === 'approved' ||
      v === 'rejected' ||
      v === 'warning'
    ) {
      return v;
    }
    return null;
  }
}
