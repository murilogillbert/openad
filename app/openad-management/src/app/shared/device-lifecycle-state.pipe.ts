import { Pipe, PipeTransform } from '@angular/core';

/** Formats lifecycle state strings for display in tables and badges. */
@Pipe({ name: 'deviceLifecycleState', standalone: true })
export class DeviceLifecycleStatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (value == null || value === '') {
      return '—';
    }
    return value;
  }
}
