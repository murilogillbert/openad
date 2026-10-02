import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ImageModule } from 'primeng/image';
import { MediaTextHighlightComponent } from './media-text-highlight.component';

@Component({
  selector: 'app-media-asset-grid',
  standalone: true,
  imports: [ImageModule, MediaTextHighlightComponent],
  template: `
    <div
      class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6"
    >
      @for (row of assets; track trackBy($index, row)) {
        <div
          role="button"
          tabindex="0"
          data-media-ctx-item
          [attr.aria-label]="'Select ' + label(row)"
          (click)="pick(row)"
          (keydown.enter)="pick(row)"
          (contextmenu)="onCtx($event, row)"
          class="group bg-surface-0 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl p-3 flex flex-col gap-2 shadow-sm hover:shadow-md hover:border-primary/20 transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <div
            class="aspect-video bg-surface-100 dark:bg-surface-800 rounded-lg overflow-hidden flex items-center justify-center"
          >
            @if (previewUrl(row)) {
              @if (isVideo(row)) {
                <video
                  class="h-full w-full object-cover"
                  [src]="previewUrl(row)!"
                  muted
                  playsinline
                  preload="metadata"
                ></video>
              } @else {
                <p-image
                  [src]="previewUrl(row)!"
                  [alt]="label(row)"
                  [preview]="false"
                  styleClass="block h-full w-full"
                  imageClass="h-full w-full object-cover"
                />
              }
            } @else {
              @if (isVideo(row)) {
                <i
                  class="pi pi-play-circle text-3xl opacity-40 group-hover:opacity-70 transition-opacity text-muted-color"
                ></i>
              } @else if (isImage(row)) {
                <i class="pi pi-image text-3xl opacity-40 text-muted-color"></i>
              } @else {
                <i class="pi pi-file text-3xl opacity-40 text-muted-color"></i>
              }
            }
          </div>
          <div class="flex min-w-0 flex-col justify-start gap-1">
            <div class="text-sm font-bold leading-snug min-w-0">
              @if (highlightQuery.trim()) {
                <app-media-text-highlight [text]="label(row)" [query]="highlightQuery" />
              } @else {
                <span class="block truncate" [title]="label(row)">{{ label(row) }}</span>
              }
            </div>
            @if (showPaths && location(row)) {
              <span
                class="line-clamp-2 text-left text-[10px] leading-tight text-muted-color"
                [title]="location(row)!"
                >{{ location(row) }}</span
              >
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class MediaAssetGridComponent {
  @Input() assets: unknown[] = [];
  @Input() highlightQuery = '';
  @Input() showPaths = false;
  @Output() selectAsset = new EventEmitter<{ mediaId: string }>();
  @Output() contextAsset = new EventEmitter<{
    event: Event;
    mediaId: string;
    filename: string;
    placementFolderId: string | null;
  }>();

  pick(row: unknown): void {
    const r = row as { mediaId?: string };
    if (r.mediaId) {
      this.selectAsset.emit({ mediaId: r.mediaId });
    }
  }

  trackBy(i: number, row: unknown): string {
    const r = row as { mediaId?: string };
    return r.mediaId ?? String(i);
  }

  label(row: unknown): string {
    const r = row as { filename?: string };
    return r.filename ?? '—';
  }

  location(row: unknown): string | null {
    const r = row as { searchLocationPath?: string };
    const p = r.searchLocationPath?.trim();
    return p ? p : null;
  }

  previewUrl(row: unknown): string | null {
    const r = row as { previewUrl?: unknown };
    return typeof r.previewUrl === 'string' && r.previewUrl.length > 0
      ? r.previewUrl
      : null;
  }

  isVideo(row: unknown): boolean {
    const r = row as { mimeType?: string };
    return typeof r.mimeType === 'string' && r.mimeType.toLowerCase().startsWith('video/');
  }

  isImage(row: unknown): boolean {
    const r = row as { mimeType?: string };
    return typeof r.mimeType === 'string' && r.mimeType.toLowerCase().startsWith('image/');
  }

  onCtx(ev: Event, row: unknown): void {
    ev.preventDefault();
    ev.stopPropagation();
    const r = row as { mediaId?: string; filename?: string; folderId?: string };
    if (!r.mediaId) {
      return;
    }
    const placementFolderId =
      typeof r.folderId === 'string' ? r.folderId : null;
    this.contextAsset.emit({
      event: ev,
      mediaId: r.mediaId,
      filename: typeof r.filename === 'string' ? r.filename : '—',
      placementFolderId,
    });
  }
}
