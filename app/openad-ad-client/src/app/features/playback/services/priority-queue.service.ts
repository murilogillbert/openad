import { Injectable } from '@angular/core';
import type { PriorityAd } from '../models/ad-queue.model';

@Injectable()
export class PriorityQueueService {
  private readonly commands: PriorityAd[] = [];

  unshift(cmd: PriorityAd): void {
    this.commands.unshift(cmd);
  }

  push(cmd: PriorityAd): void {
    this.commands.push(cmd);
  }

  /** First non-expired command, or undefined. */
  peek(): PriorityAd | undefined {
    const now = Date.now();
    while (this.commands.length > 0) {
      const first = this.commands[0]!;
      const exp = Date.parse(first.expiresAt);
      if (Number.isNaN(exp) || exp <= now) {
        this.commands.shift();
        continue;
      }
      return first;
    }
    return undefined;
  }

  /** Remove head after it has been played. */
  shift(): PriorityAd | undefined {
    return this.commands.shift();
  }

  clear(): void {
    this.commands.length = 0;
  }
}
