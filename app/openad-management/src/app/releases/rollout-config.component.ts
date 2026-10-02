import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Observable, catchError, concat, map, of, switchMap } from 'rxjs';
import { ReleasesApiService, type RolloutDto } from './releases-api.service';

@Component({
  selector: 'app-rollout-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section
      class="rounded-xl border border-surface-200 bg-surface-0 p-4 dark:border-surface-300 dark:bg-surface-100"
    >
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-color">Staged rollout</h3>
        <button
          type="button"
          class="text-xs font-medium text-primary hover:underline"
          (click)="reload()"
        >
          Refresh
        </button>
      </div>
      @if (vm$ | async; as vm) {
        @if (vm.loading) {
          <p class="text-sm text-muted-color">Loading…</p>
        } @else {
        <div class="flex flex-col gap-3 text-sm">
          <label class="flex flex-col gap-1">
            <span class="text-muted-color">Target release id</span>
            <input
              class="rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 font-mono text-xs text-color"
              [(ngModel)]="draftReleaseId"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-muted-color">Device group ids (comma-separated)</span>
            <input
              class="rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-color"
              [(ngModel)]="draftGroups"
              placeholder="group-a-uuid, group-b-uuid"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-muted-color">Rollout % (0–100, empty = no % gate)</span>
            <input
              type="number"
              min="0"
              max="100"
              class="rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-color"
              [(ngModel)]="draftPct"
            />
          </label>
          <button
            type="button"
            class="w-fit rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-contrast hover:opacity-90"
            (click)="create()"
          >
            Create rollout
          </button>
        </div>
        <ul class="mt-4 space-y-2 border-t border-surface-200 pt-3 text-sm dark:border-surface-300">
          @for (r of vm.rollouts; track r._id) {
            <li
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-200 bg-surface-50 px-2 py-2 dark:border-surface-400 dark:bg-surface-200"
            >
              <span class="font-mono text-xs text-color">{{ r._id }}</span>
              <span class="text-muted-color">{{ r.status }}</span>
              <div class="flex gap-1">
                @if (r.status === 'draft' || r.status === 'paused') {
                  <button
                    type="button"
                    class="rounded-md bg-surface-200 px-2 py-0.5 text-xs text-color dark:bg-surface-400"
                    (click)="setStatus(r._id, 'active')"
                  >
                    Activate
                  </button>
                }
                @if (r.status === 'active') {
                  <button
                    type="button"
                    class="rounded-md border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
                    (click)="setStatus(r._id, 'paused')"
                  >
                    Pause
                  </button>
                }
              </div>
            </li>
          }
        </ul>
        }
      }
    </section>
  `,
})
export class RolloutConfigComponent implements OnInit {
  private readonly api = inject(ReleasesApiService);

  readonly changed = output<void>();

  private readonly reload$ = new BehaviorSubject<void>(undefined);
  protected readonly vm$: Observable<{ loading: boolean; rollouts: RolloutDto[] }> =
    this.reload$.pipe(
      switchMap(() =>
        concat(
          of({ loading: true, rollouts: [] as RolloutDto[] }),
          this.api.listRollouts().pipe(
            map((rollouts) => ({ loading: false, rollouts })),
            catchError(() => of({ loading: false, rollouts: [] as RolloutDto[] }))
          )
        )
      )
    );

  protected draftReleaseId = '';
  protected draftGroups = '';
  protected draftPct: number | null = null;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.reload$.next();
  }

  create(): void {
    const ids = this.draftGroups
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.api
      .createRollout(this.draftReleaseId.trim(), {
        deviceGroupIds: ids,
        percentage:
          this.draftPct === null || this.draftPct === undefined
            ? null
            : Number(this.draftPct),
      })
      .subscribe({
        next: () => {
          this.changed.emit();
          this.reload();
        },
      });
  }

  setStatus(id: string, status: RolloutDto['status']): void {
    this.api.patchRollout(id, status).subscribe({
      next: () => {
        this.changed.emit();
        this.reload();
      },
    });
  }
}
