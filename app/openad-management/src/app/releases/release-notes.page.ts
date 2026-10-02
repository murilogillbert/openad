import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { ReleasesApiService, type FieldReleaseNoteItemDto } from './releases-api.service';

/**
 * Read-only release notes for fleet / field staff (no APK or admin actions).
 * Backed by GET /releases/field-notes.
 */
@Component({
  selector: 'app-release-notes-page',
  standalone: true,
  imports: [CommonModule, TableModule, ToastModule],
  providers: [MessageService],
  template: `
    <p-toast />
    <div class="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-extrabold tracking-tight text-color">App release notes</h1>
      <p class="mt-2 text-sm text-muted-color">
        Build descriptions for your field team. This list is read-only; uploads happen under
        Device app releases (super admin).
      </p>
      @if (loading()) {
        <p class="mt-6 text-sm text-muted-color">Loading…</p>
      } @else {
        <div class="mt-6 w-full min-w-0 overflow-x-auto">
        <p-table
          [value]="rows()"
          [tableStyle]="{ 'min-width': '100%' }"
        >
          <ng-template pTemplate="header">
            <tr>
              <th>Version</th>
              <th>Date</th>
              <th>Notes</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td class="font-mono text-sm text-color">{{ row.versionIdentifier }}</td>
              <td class="whitespace-nowrap text-sm text-muted-color">
                {{ formatDate(row.createdAt) }}
              </td>
              <td class="text-sm text-color">
                @if (row.releaseNotes) {
                  <span class="whitespace-pre-wrap">{{ row.releaseNotes }}</span>
                } @else {
                  <span class="text-muted-color">—</span>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="3" class="py-8 text-center text-sm text-muted-color">
                No release notes available yet.
              </td>
            </tr>
          </ng-template>
        </p-table>
        </div>
      }
    </div>
  `,
})
export class ReleaseNotesPage implements OnInit {
  private readonly api = inject(ReleasesApiService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly rows = signal<FieldReleaseNoteItemDto[]>([]);

  ngOnInit(): void {
    this.loading.set(true);
    this.api.listFieldReleaseNotes().subscribe({
      next: (r) => {
        this.rows.set(r ?? []);
        this.loading.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Could not load release notes',
          detail: e.error?.message ?? e.message,
        });
      },
    });
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
}
