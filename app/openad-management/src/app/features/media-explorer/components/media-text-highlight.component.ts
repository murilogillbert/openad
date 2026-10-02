import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Component({
  selector: 'app-media-text-highlight',
  standalone: true,
  template: `
    <span class="inline min-w-0 break-words [word-break:break-word]" [innerHTML]="safeHtml"></span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaTextHighlightComponent implements OnChanges {
  private readonly sanitizer = inject(DomSanitizer);

  @Input() text = '';
  @Input() query = '';

  safeHtml: SafeHtml | string = '';

  ngOnChanges(): void {
    const t = this.text ?? '';
    const q = this.query?.trim() ?? '';
    if (!q) {
      this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(escapeHtml(t));
      return;
    }
    let esc: string;
    try {
      esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } catch {
      this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(escapeHtml(t));
      return;
    }
    const parts = t.split(new RegExp(`(${esc})`, 'gi'));
    const html = parts
      .map((part) => {
        if (part.toLowerCase() === q.toLowerCase()) {
          return `<mark class="rounded bg-primary/20 px-0.5 text-color dark:bg-primary/30">${escapeHtml(part)}</mark>`;
        }
        return escapeHtml(part);
      })
      .join('');
    this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
