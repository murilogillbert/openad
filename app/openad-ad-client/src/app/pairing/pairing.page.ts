import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PairingApiService } from '../services/pairing-api.service';

@Component({
  standalone: true,
  selector: 'app-pairing-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './pairing.page.html',
  styleUrl: './pairing.page.css',
})
export class PairingPage {
  private readonly pairing = inject(PairingApiService);

  protected readonly deviceId = signal<string | null>(null);
  protected readonly secretCode = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly success = signal(false);

  protected async onRegister(): Promise<void> {
    this.error.set(null);
    this.success.set(false);
    this.loading.set(true);
    try {
      const res = await this.pairing.register();
      this.deviceId.set(res.deviceId);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Register failed');
    } finally {
      this.loading.set(false);
    }
  }

  protected async onBind(): Promise<void> {
    this.error.set(null);
    this.success.set(false);
    const code = this.secretCode().trim();
    if (!code) {
      this.error.set('Enter the pairing code');
      return;
    }
    this.loading.set(true);
    try {
      await this.pairing.bind(code);
      this.success.set(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Bind failed');
    } finally {
      this.loading.set(false);
    }
  }
}
