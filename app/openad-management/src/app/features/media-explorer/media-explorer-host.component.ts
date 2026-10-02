import { Component } from '@angular/core';
import { MediaExplorerShellComponent } from './layout/media-explorer-shell.component';

/**
 * Entry for the 007 media VFS explorer (tree + grid + uploads).
 */
@Component({
  selector: 'app-media-explorer-host',
  standalone: true,
  imports: [MediaExplorerShellComponent],
  host: {
    class: 'flex min-h-0 min-w-0 grow flex-1 flex-col overflow-hidden',
  },
  template: ` <app-media-explorer-shell /> `,
})
export class MediaExplorerHostComponent {}
