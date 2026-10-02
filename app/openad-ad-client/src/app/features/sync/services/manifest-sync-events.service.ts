import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Emitted after a successful manifest sync completes (playback can rebuild queues). */
@Injectable({ providedIn: 'root' })
export class ManifestSyncEventsService {
  readonly manifestSynced$ = new Subject<void>();

  notifyManifestSynced(): void {
    this.manifestSynced$.next();
  }
}
