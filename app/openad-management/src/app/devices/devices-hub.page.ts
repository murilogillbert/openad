import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterModule,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { TabsModule } from 'primeng/tabs';
import { OperationsTelemetryService } from '../operations/operations-telemetry.service';

type HubTab = 'vehicles' | 'hardware' | 'pairing';

@Component({
  selector: 'app-devices-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, TabsModule],
  templateUrl: './devices-hub.page.html',
})
export class DevicesHubPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly opsTelemetry = inject(OperationsTelemetryService);

  /** Drives p-tabs; synced from URL (vehicles | hardware | pairing). */
  readonly tabValue = signal<string | undefined>('vehicles');

  constructor() {
    const sync = () => this.tabValue.set(this.tabKeyFromUrl(this.router.url));
    sync();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(sync);
  }

  ngOnInit(): void {
    this.opsTelemetry.connect();
  }

  ngOnDestroy(): void {
    this.opsTelemetry.disconnect();
  }

  onTabChange(next: string | number | undefined): void {
    const key = (next != null ? String(next) : 'vehicles') as HubTab;
    if (this.tabKeyFromUrl(this.router.url) === key) {
      return;
    }
    void this.router.navigate([key], { relativeTo: this.route });
  }

  private tabKeyFromUrl(url: string): HubTab {
    const path = url.split('?')[0] ?? url;
    const marker = '/devices/';
    const i = path.indexOf(marker);
    if (i < 0) {
      return 'vehicles';
    }
    const rest = path.slice(i + marker.length);
    const first = rest.split('/').filter(Boolean)[0] ?? '';
    if (first === 'hardware') {
      return 'hardware';
    }
    if (first === 'pairing') {
      return 'pairing';
    }
    return 'vehicles';
  }
}
