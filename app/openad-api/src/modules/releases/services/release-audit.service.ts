import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReleaseAuditEvent,
  ReleaseAuditEventDocument,
} from '../schemas/release-audit-event.schema';

@Injectable()
export class ReleaseAuditService {
  constructor(
    @InjectModel(ReleaseAuditEvent.name)
    private readonly model: Model<ReleaseAuditEventDocument>
  ) {}

  async record(params: {
    actorUserId: string;
    action: string;
    subjectId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.model.create({
      actorUserId: params.actorUserId,
      action: params.action,
      subjectId: params.subjectId ?? null,
      metadata: params.metadata ?? null,
    });
  }
}
