import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { Component, OnInit, inject } from '@angular/core';
import type { DeviceGroupResponse } from '@openad/api-contracts';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DeviceGroupsPortalService } from './device-groups.service';
import { InventoryService } from '../inventory/inventory.service';

@Component({
  selector: 'app-device-groups',
  standalone: true,
  imports: [CommonModule, DragDropModule, ToastModule],
  templateUrl: './device-groups.component.html',
})
export class DeviceGroupsComponent implements OnInit {
  private readonly groupsApi = inject(DeviceGroupsPortalService);
  private readonly inventory = inject(InventoryService);
  private readonly messages = inject(MessageService);

  protected loading = false;
  protected groups: DeviceGroupResponse[] = [];
  protected profileNames: Record<string, string> = {};
  protected poolList: string[] = [];
  protected groupBuckets: Record<string, string[]> = {};
  protected listIds: string[] = ['pool'];
  /** JSON drafts for `PATCH .../sync-windows` (003). */
  protected syncWindowsDraft: Record<string, string> = {};

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.groupsApi.getProfiles(1, 200).subscribe({
      next: (prof) => {
        this.profileNames = {};
        for (const p of prof.data) {
          this.profileNames[p.profileId] = p.name;
        }
      },
    });
    this.groupsApi.getGroups(1, 200).subscribe({
      next: (g) => {
        this.groups = g.data;
        this.poolList = [];
        this.groupBuckets = {};
        this.listIds = ['pool'];
        for (const row of g.data) {
          this.groupBuckets[row.groupId] = this.groupBuckets[row.groupId] ?? [];
          this.listIds.push(row.groupId);
          this.syncWindowsDraft[row.groupId] = JSON.stringify(
            row.syncWindowRules ?? [],
            null,
            2
          );
        }
        this.fillPoolFromFleet();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.messages.add({
          severity: 'error',
          summary: 'Load failed',
          detail: 'Could not load device groups',
        });
      },
    });
  }

  private fillPoolFromFleet(): void {
    this.inventory.listVehicles({ page: 1, limit: 500 }).subscribe({
      next: (v) => {
        const all = v.data
          .map((row) => row.boundDevice?.deviceId)
          .filter((id): id is string => !!id);
        const placed = new Set<string>();
        for (const id of this.listIds) {
          if (id === 'pool') continue;
          for (const d of this.groupBuckets[id] ?? []) placed.add(d);
        }
        this.poolList = all.filter((id) => !placed.has(id));
      },
    });
  }

  protected trackGroup = (_: number, g: DeviceGroupResponse) => g.groupId;

  protected drop(event: CdkDragDrop<string[]>): void {
    const targetId = event.container.id;
    const prevId = event.previousContainer.id;

    if (event.previousContainer === event.container) {
      moveItemInArray(
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
      return;
    }

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );

    if (targetId === 'pool') {
      if (prevId !== 'pool') {
        this.persistGroup(prevId);
      }
      return;
    }

    if (prevId === 'pool') {
      this.persistGroup(targetId);
      return;
    }

    this.persistGroup(prevId);
    this.persistGroup(targetId);
  }

  protected saveSyncWindows(groupId: string): void {
    const raw = this.syncWindowsDraft[groupId] ?? '[]';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.messages.add({
        severity: 'error',
        summary: 'Invalid JSON',
        detail: 'Sync windows must be a JSON array',
      });
      return;
    }
    if (!Array.isArray(parsed)) {
      this.messages.add({
        severity: 'error',
        summary: 'Invalid shape',
        detail: 'Expected an array of rules',
      });
      return;
    }
    const rules = parsed.map((r: Record<string, unknown>) => ({
      startTime: String(r['startTime'] ?? ''),
      endTime: String(r['endTime'] ?? ''),
      daysOfWeek: Array.isArray(r['daysOfWeek'])
        ? (r['daysOfWeek'] as unknown[]).map((d) => Number(d))
        : [],
      sizeThresholdMb: Number(r['sizeThresholdMb'] ?? 0),
    }));
    this.groupsApi.updateSyncWindows(groupId, { rules }).subscribe({
      next: (res) => {
        this.syncWindowsDraft[groupId] = JSON.stringify(
          res.syncWindowRules ?? [],
          null,
          2
        );
        this.messages.add({
          severity: 'success',
          summary: 'Sync windows saved',
          detail: `Config revision ${res.configRevision ?? 0}`,
        });
      },
      error: () => {
        this.messages.add({
          severity: 'error',
          summary: 'Save failed',
          detail: 'Could not update sync windows',
        });
      },
    });
  }

  private persistGroup(groupId: string): void {
    if (groupId === 'pool') return;
    const ids = this.groupBuckets[groupId] ?? [];
    this.groupsApi.updateGroupMembers(groupId, ids).subscribe({
      next: () => {
        this.messages.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Group membership updated',
        });
      },
      error: () => {
        this.messages.add({
          severity: 'error',
          summary: 'Update failed',
          detail: 'Could not update group members',
        });
        this.refresh();
      },
    });
  }
}
