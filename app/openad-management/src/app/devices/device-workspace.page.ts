import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import {
  vehicleBindingLabel,
  vehicleBindingSeverity,
} from '../inventory/vehicle-binding-labels';
import { DeviceDetailStore } from './device-detail.store';

@Component({
  selector: 'app-device-workspace',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    ProgressSpinnerModule,
    TagModule,
  ],
  providers: [DeviceDetailStore],
  templateUrl: './device-workspace.page.html',
})
export class DeviceWorkspacePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(DeviceDetailStore);

  protected readonly bindingLabel = vehicleBindingLabel;
  protected readonly bindingSeverity = vehicleBindingSeverity;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const id = pm.get('vehicleId');
        if (id) {
          this.store.load(id);
        }
      });
  }

  protected backToFleet(): void {
    void this.router.navigateByUrl('/devices/vehicles');
  }
}
