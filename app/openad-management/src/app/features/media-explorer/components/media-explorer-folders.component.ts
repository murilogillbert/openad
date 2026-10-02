import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { MediaFolderNode } from '@openad/api-contracts';
import { MediaTextHighlightComponent } from './media-text-highlight.component';

@Component({
  selector: 'app-media-explorer-folders',
  standalone: true,
  imports: [MediaTextHighlightComponent],
  template: `
    @if (parentUpId || folders.length > 0) {
      <div class="mb-6">
        <h3 class="text-xs font-bold uppercase tracking-wider text-muted-color mb-3">
          Folders
        </h3>
        <div
          class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6"
        >
          @if (parentUpId) {
            <button
              type="button"
              data-media-ctx-item
              class="group bg-surface-0 dark:bg-surface-900 border border-dashed border-primary/40 dark:border-primary/30 rounded-xl p-3 flex flex-col gap-2 shadow-sm hover:shadow-md hover:border-primary/50 transition-shadow text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
              (click)="open.emit(parentUpId)"
              (contextmenu)="onParentCtx($event, parentUpId)"
              aria-label="Go to parent folder"
            >
              <div
                class="aspect-video bg-surface-100 dark:bg-surface-800 rounded-lg flex items-center justify-center text-primary"
              >
                <i class="pi pi-arrow-circle-up text-4xl opacity-80 group-hover:opacity-100"></i>
              </div>
              <div class="text-sm font-bold truncate text-primary" title="Parent folder">..</div>
              <span class="text-xs text-muted-color">Up</span>
            </button>
          }
          @for (f of folders; track f.id) {
            <button
              type="button"
              data-media-ctx-item
              class="group bg-surface-0 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl p-3 flex flex-col gap-2 shadow-sm hover:shadow-md hover:border-primary/30 transition-shadow text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
              (click)="open.emit(f.id)"
              (contextmenu)="onFolderCtx($event, f)"
            >
              <div
                class="aspect-video bg-surface-100 dark:bg-surface-800 rounded-lg flex items-center justify-center text-primary"
              >
                <i class="pi pi-folder text-4xl opacity-80 group-hover:opacity-100"></i>
              </div>
              <div class="min-w-0 text-sm font-bold leading-snug text-color" [title]="f.name">
                @if (highlightQuery.trim()) {
                  <app-media-text-highlight [text]="f.name" [query]="highlightQuery" />
                } @else {
                  <span class="block truncate">{{ f.name }}</span>
                }
              </div>
              @if (showPaths) {
                <span
                  class="line-clamp-2 text-left text-[10px] leading-tight text-muted-color"
                  [title]="f.materializedPath"
                  >{{ f.materializedPath }}</span
                >
              }
              <span class="text-xs text-muted-color">Folder</span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class MediaExplorerFoldersComponent {
  @Input({ required: true }) folders: MediaFolderNode[] = [];
  /** When set, first tile navigates to this folder id (parent / “..”). */
  @Input() parentUpId: string | null = null;
  /** Search mode: highlight substring matches in folder names. */
  @Input() highlightQuery = '';
  /** Search mode: show materialized path under the title. */
  @Input() showPaths = false;
  @Output() readonly open = new EventEmitter<string>();
  @Output() readonly contextFolder = new EventEmitter<{
    event: Event;
    folder: MediaFolderNode;
  }>();
  @Output() readonly contextParentUp = new EventEmitter<{
    event: Event;
    parentId: string;
  }>();

  onFolderCtx(ev: Event, folder: MediaFolderNode): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextFolder.emit({ event: ev, folder });
  }

  onParentCtx(ev: Event, parentId: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextParentUp.emit({ event: ev, parentId });
  }
}
