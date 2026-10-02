import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import {
  PairingAttemptLogRecord,
  type PairingAttemptLogDocument,
} from './schemas/pairing-attempt-log.schema';

export type PairingAuditOutcome =
  | 'success'
  | 'failure'
  | 'expired'
  | 'replay'
  | 'hardware_mismatch';

@Injectable()
export class PairingAuditService {
  constructor(
    @InjectModel(PairingAttemptLogRecord.name)
    private readonly log: Model<PairingAttemptLogDocument>
  ) {}

  async record(params: {
    deviceId: string | null;
    fingerprintHash: string;
    outcome: PairingAuditOutcome;
    detail?: string | null;
  }): Promise<void> {
    await new this.log({
      logId: randomUUID(),
      deviceId: params.deviceId,
      fingerprintHash: params.fingerprintHash,
      outcome: params.outcome,
      detail: params.detail ?? null,
    }).save();
  }
}
