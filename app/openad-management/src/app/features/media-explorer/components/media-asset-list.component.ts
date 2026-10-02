import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TableModule } from 'primeng/table';
import { MediaTextHighlightComponent } from './media-text-highlight.component';

export type MediaExplorerListRow =
  | { kind: 'parent'; parentId: string }
  | { kind: 'folder'; id: string; name: string; pathLabel?: string }
  | {
      kind: 'file';
      mediaId: string;
      filename: string;
      fileSize: number;
      codec?: string;
      mimeType?: string;
      pathLabel?: string;
      /** Folder placement; omit in browse mode when same as current folder. */
      placementFolderId?: string;
    };

@Component({
  selector: 'app-media-asset-list',
  standalone: true,
  imports: [TableModule, DecimalPipe, MediaTextHighlightComponent],
  template: `
    <p-table
      [value]="rows"
      [scrollable]="true"
      scrollHeight="flex"
      styleClass="p-datatable-sm w-full"
      [tableStyle]="{ 'min-width': '100%' }"
    >
      <ng-template pTemplate="header">
        <tr>
          <th class="!pl-4 md:!pl-6">Name</th>
          @if (showLocationColumn) {
            <th class="min-w-[8rem] max-w-[min(28rem,40vw)]">Location</th>
          }
          <th class="w-28 text-right">Size</th>
          <th class="w-36 md:w-44">Type</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-row>
        @switch (row.kind) {
          @case ('parent') {
            <tr
              data-media-ctx-item
              class="cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800"
              role="button"
              tabindex="0"
              aria-label="Go to parent folder"
              (click)="goParent(row)"
              (keydown.enter)="goParent(row)"
              (contextmenu)="onParentCtx($event, row)"
            >
              <td class="!pl-4 font-semibold text-primary md:!pl-6">..</td>
              @if (showLocationColumn) {
                <td class="text-muted-color">—</td>
              }
              <td class="text-right text-muted-color">—</td>
              <td class="text-muted-color">Folder</td>
            </tr>
          }
          @case ('folder') {
            <tr
              data-media-ctx-item
              class="cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800"
              role="button"
              tabindex="0"
              [attr.aria-label]="'Open folder ' + row.name"
              (click)="openFolderRow(row)"
              (keydown.enter)="openFolderRow(row)"
              (contextmenu)="onFolderCtx($event, row)"
            >
              <td class="!pl-4 md:!pl-6">
                <span class="inline-flex min-w-0 items-center gap-2">
                  <i class="pi pi-folder shrink-0 text-primary" aria-hidden="true"></i>
                  <span class="min-w-0 font-medium">
                @if ((highlightQuery || '').trim()) {
                  <app-media-text-highlight [text]="row.name" [query]="highlightQuery" />
                    } @else {
                      {{ row.name }}
                    }
                  </span>
                </span>
              </td>
              @if (showLocationColumn) {
                <td class="max-w-[min(28rem,40vw)] truncate text-xs text-muted-color" [title]="row.pathLabel || ''">
                  {{ row.pathLabel || '—' }}
                </td>
              }
              <td class="text-right text-muted-color">—</td>
              <td class="text-muted-color">Folder</td>
            </tr>
          }
          @case ('file') {
            <tr
              data-media-ctx-item
              class="cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800"
              role="button"
              tabindex="0"
              [attr.aria-label]="'Select ' + row.filename"
              (click)="pickFile(row)"
              (keydown.enter)="pickFile(row)"
              (contextmenu)="onFileCtx($event, row)"
            >
              <td class="!pl-4 md:!pl-6">
                @if ((highlightQuery || '').trim()) {
                  <app-media-text-highlight [text]="row.filename" [query]="highlightQuery" />
                } @else {
                  {{ row.filename }}
                }
              </td>
              @if (showLocationColumn) {
                <td class="max-w-[min(28rem,40vw)] truncate text-xs text-muted-color" [title]="row.pathLabel || ''">
                  {{ row.pathLabel || '—' }}
                </td>
              }
              <td class="text-right tabular-nums">{{ row.fileSize | number }}</td>
              <td class="text-muted-color">{{ fileTypeLabel(row) }}</td>
            </tr>
          }
        }
      </ng-template>
    </p-table>
  `,
})
export class MediaAssetListComponent {
  @Input({ required: true }) rows: MediaExplorerListRow[] = [];
  @Input() highlightQuery = '';
  @Input() showLocationColumn = false;

  @Output() readonly navigateFolder = new EventEmitter<string>();
  @Output() readonly selectAsset = new EventEmitter<{ mediaId: string }>();
  @Output() readonly contextParentUp = new EventEmitter<{
    event: Event;
    parentId: string;
  }>();
  @Output() readonly contextFolderRow = new EventEmitter<{
    event: Event;
    id: string;
    name: string;
  }>();
  @Output() readonly contextFileRow = new EventEmitter<{
    event: Event;
    mediaId: string;
    filename: string;
    placementFolderId: string | null;
  }>();

  goParent(row: Extract<MediaExplorerListRow, { kind: 'parent' }>): void {
    this.navigateFolder.emit(row.parentId);
  }

  openFolderRow(row: Extract<MediaExplorerListRow, { kind: 'folder' }>): void {
    this.navigateFolder.emit(row.id);
  }

  pickFile(row: Extract<MediaExplorerListRow, { kind: 'file' }>): void {
    this.selectAsset.emit({ mediaId: row.mediaId });
  }

  onParentCtx(
    ev: Event,
    row: Extract<MediaExplorerListRow, { kind: 'parent' }>
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextParentUp.emit({ event: ev, parentId: row.parentId });
  }

  onFolderCtx(
    ev: Event,
    row: Extract<MediaExplorerListRow, { kind: 'folder' }>
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextFolderRow.emit({ event: ev, id: row.id, name: row.name });
  }

  onFileCtx(
    ev: Event,
    row: Extract<MediaExplorerListRow, { kind: 'file' }>
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextFileRow.emit({
      event: ev,
      mediaId: row.mediaId,
      filename: row.filename,
      placementFolderId: row.placementFolderId ?? null,
    });
  }

  fileTypeLabel(row: Extract<MediaExplorerListRow, { kind: 'file' }>): string {
    if (row.mimeType?.trim()) {
      return row.mimeType.trim();
    }
    if (row.codec === 'h264') {
      return 'Video (H.264)';
    }
    if (row.codec === 'h265') {
      return 'Video (H.265)';
    }
    return 'Video';
  }
}
