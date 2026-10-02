import { Component, Input } from '@angular/core';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'app-media-validation-badge',
  standalone: true,
  imports: [TagModule],
  template: `
    @if (status) {
      <p-tag
        [severity]="severity"
        [value]="label"
        [rounded]="true"
      />
    }
  `,
})
export class MediaValidationBadgeComponent {
  @Input() status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'warning'
    | undefined
    | null = null;

  get severity(): 'success' | 'warn' | 'danger' | 'secondary' | 'info' | 'contrast' {
    switch (this.status) {
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'warning':
        return 'warn';
      case 'pending':
      default:
        return 'secondary';
    }
  }

  get label(): string {
    switch (this.status) {
      case 'approved':
        return 'Validated';
      case 'rejected':
        return 'Rejected';
      case 'warning':
        return 'Warning';
      case 'pending':
        return 'Pending';
      default:
        return '—';
    }
  }
}
