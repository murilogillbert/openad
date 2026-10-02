import { Component } from '@angular/core';
import { MediaExplorerHostComponent } from '../features/media-explorer';

/**
 * Media explorer fills the main column: flex child must stay within the viewport (see shell max-height).
 */
@Component({
  selector: 'app-media-management-page',
  standalone: true,
  imports: [MediaExplorerHostComponent],
  host: {
    class:
      'flex min-h-0 min-w-0 w-full flex-1 flex-col self-stretch overflow-hidden',
  },
  template: ` <app-media-explorer-host class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" /> `,
})
export class MediaManagementPage {}
