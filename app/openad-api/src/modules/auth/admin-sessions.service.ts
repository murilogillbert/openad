import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminSessionsRepository } from './admin-sessions.repository';

@Injectable()
export class AdminSessionsService {
  constructor(private readonly repo: AdminSessionsRepository) {}

  async getOrCreateSessionForDevice(params: {
    userId: string;
    deviceId: string;
    label: string;
  }): Promise<string> {
    const now = new Date();
    const row = await this.repo.upsertForUserDevice({
      userId: params.userId,
      deviceId: params.deviceId,
      label: params.label,
      now,
      newSessionId: randomUUID(),
    });
    return row.sessionId;
  }

  async createSession(params: { userId: string; label: string }): Promise<string> {
    const sessionId = randomUUID();
    const now = new Date();
    await this.repo.create({ sessionId, userId: params.userId, label: params.label, now });
    return sessionId;
  }

  async assertActiveSession(sessionId: string): Promise<void> {
    const s = await this.repo.findBySessionId(sessionId);
    if (!s || s.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }
  }

  async listSessions(params: { userId: string; currentSessionId: string }) {
    const rows = await this.repo.listForUser(params.userId);
    return rows.map((s) => ({
      sessionId: s.sessionId,
      label: s.label,
      lastActiveAt: s.lastActiveAt.toISOString(),
      isCurrent: s.sessionId === params.currentSessionId,
    }));
  }

  async revokeOtherSessions(params: { userId: string; keepSessionId: string }): Promise<number> {
    // Safety: never revoke the current session (and ensure it still exists).
    await this.assertActiveSession(params.keepSessionId);
    const now = new Date();
    return this.repo.revokeOthers({ userId: params.userId, keepSessionId: params.keepSessionId, now });
  }

  async touch(sessionId: string): Promise<void> {
    await this.repo.touch(sessionId, new Date());
  }
}

