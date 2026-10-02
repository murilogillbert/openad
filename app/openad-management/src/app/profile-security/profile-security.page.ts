import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { FileUploadModule } from 'primeng/fileupload';
import { ImageModule } from 'primeng/image';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import type { AdminSessionListItem } from '@openad/api-contracts';
import type { AdminMeResponse } from '@openad/api-contracts';
import { ProfileSecurityApiService } from './profile-security-api.service';

@Component({
  selector: 'app-profile-security-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToastModule,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    TagModule,
    ImageModule,
    FileUploadModule,
  ],
  providers: [MessageService],
  templateUrl: './profile-security.page.html',
})
export class ProfileSecurityPage implements OnInit {
  private readonly api = inject(ProfileSecurityApiService);
  protected readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly me = signal<AdminMeResponse | null>(null);

  protected displayName = '';
  protected contactEmail: string | null = null;
  protected contactPhone: string | null = null;

  protected currentPassword = '';
  protected newPassword = '';
  protected confirmNewPassword = '';

  protected readonly sessions = signal<AdminSessionListItem[]>([]);
  protected readonly sessionsLoading = signal(true);

  protected readonly revokeAllDisabled = computed(() => {
    const s = this.sessions();
    return s.length === 1 && !!s[0]?.isCurrent;
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.sessionsLoading.set(true);

    this.api.getMe().subscribe({
      next: (m) => {
        this.me.set(m);
        this.displayName = m.displayName ?? '';
        this.contactEmail = m.contactEmail ?? null;
        this.contactPhone = m.contactPhone ?? null;
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Failed to load profile',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });

    this.api.listSessions().subscribe({
      next: (r) => {
        this.sessions.set(r.items ?? []);
        this.sessionsLoading.set(false);
      },
      error: () => {
        this.sessionsLoading.set(false);
      },
    });
  }

  saveProfile(): void {
    this.api
      .patchMe({
        displayName: this.displayName?.trim(),
        contactEmail: this.contactEmail?.trim() || null,
        contactPhone: this.contactPhone?.trim() || null,
      })
      .subscribe({
        next: () => {
          this.messages.add({ severity: 'success', summary: 'Profile updated' });
          this.reload();
        },
        error: (e) => {
          this.messages.add({
            severity: 'error',
            summary: 'Update failed',
            detail: e?.error?.message ?? String(e?.message ?? e),
          });
        },
      });
  }

  changePassword(): void {
    if (!this.currentPassword || !this.newPassword || !this.confirmNewPassword) {
      this.messages.add({
        severity: 'warn',
        summary: 'Enter current + new passwords',
      });
      return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.messages.add({
        severity: 'warn',
        summary: 'Passwords do not match',
      });
      return;
    }
    this.api
      .changePassword({
        currentPassword: this.currentPassword,
        newPassword: this.newPassword,
      })
      .subscribe({
        next: () => {
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.messages.add({ severity: 'success', summary: 'Password changed' });
        },
        error: (e) => {
          this.messages.add({
            severity: 'error',
            summary: 'Password change failed',
            detail: e?.error?.message ?? String(e?.message ?? e),
          });
        },
      });
  }

  revokeOthers(): void {
    const ok = window.confirm('Log out of all other devices?');
    if (!ok) return;
    this.api.revokeOtherSessions().subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Other sessions revoked' });
        this.reload();
      },
      error: (e) => {
        this.messages.add({
          severity: 'error',
          summary: 'Revoke failed',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });
  }

  protected isActiveNow(lastActiveAt: string): boolean {
    const t = Date.parse(lastActiveAt);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < 5 * 60 * 1000;
  }

  protected onPhotoFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    // Reset so selecting the same file again triggers change
    if (input) input.value = '';
    this.api.uploadPhoto(file).subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Profile photo updated' });
        this.reload();
      },
      error: (e) => {
        this.messages.add({
          severity: 'error',
          summary: 'Photo upload failed',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });
  }

  protected removePhoto(): void {
    const ok = window.confirm('Remove profile photo?');
    if (!ok) return;
    this.api.deletePhoto().subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Profile photo removed' });
        this.reload();
      },
      error: (e) => {
        this.messages.add({
          severity: 'error',
          summary: 'Remove failed',
          detail: e?.error?.message ?? String(e?.message ?? e),
        });
      },
    });
  }
}

