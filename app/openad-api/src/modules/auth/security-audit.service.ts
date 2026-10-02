import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import {
  SecurityAuditEvent,
  SecurityAuditEventDocument,
} from './schemas/security-audit-event.schema';

@Injectable()
export class SecurityAuditService {
  constructor(
    @InjectModel(SecurityAuditEvent.name)
    private readonly events: Model<SecurityAuditEventDocument>
  ) {}

  async record(params: {
    actorUserId: string;
    action: SecurityAuditEvent['action'];
    subjectId: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await new this.events({
      eventId: randomUUID(),
      actorUserId: params.actorUserId,
      action: params.action,
      subjectId: params.subjectId,
      metadata: params.metadata ?? {},
    }).save();
  }
}

