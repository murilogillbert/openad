import { Injectable } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PairingEventsService {
  private readonly pairedSubject = new Subject<{ deviceId: string }>();
  readonly pairingComplete$: Observable<{ deviceId: string }> =
    this.pairedSubject.asObservable();

  emitPairingComplete(deviceId: string): void {
    this.pairedSubject.next({ deviceId });
  }
}
