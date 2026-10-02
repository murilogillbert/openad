import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { DevicesRepository } from '../../devices/devices.repository';
import type { DeviceDocument } from '../../devices/devices.schema';
import { AppRelease, AppReleaseDocument } from '../schemas/app-release.schema';
import { RolloutRecord, RolloutDocument } from '../schemas/rollout.schema';

@Injectable()
export class RolloutEligibilityService {
  constructor(
    @InjectModel(AppRelease.name)
    private readonly releases: Model<AppReleaseDocument>,
    @InjectModel(RolloutRecord.name)
    private readonly rollouts: Model<RolloutDocument>,
    private readonly devices: DevicesRepository
  ) {}

  /**
   * Picks the newest active rollout and its release; does not evaluate per-device eligibility.
   */
  async resolveUpdateTarget(deviceId: string): Promise<{
    device: DeviceDocument;
    rollout: RolloutDocument | null;
    targetRelease: AppReleaseDocument | null;
  }> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    const rollout = await this.rollouts
      .findOne({ status: 'active' })
      .sort({ startedAt: -1, createdAt: -1 })
      .exec();
    if (!rollout) {
      return { device, rollout: null, targetRelease: null };
    }
    const targetRelease = await this.releases.findById(rollout.releaseId).exec();
    if (!targetRelease || targetRelease.status === 'revoked') {
      return { device, rollout, targetRelease: null };
    }
    return { device, rollout, targetRelease };
  }

  async isDeviceEligible(params: {
    deviceId: string;
    rollout: RolloutDocument;
    device: DeviceDocument;
  }): Promise<boolean> {
    const { rollout, device } = params;

    if (rollout.deviceGroupIds?.length) {
      const gid = device.groupId;
      if (!gid || !rollout.deviceGroupIds.includes(gid)) {
        return false;
      }
    }

    if (rollout.percentage != null && rollout.percentage < 100) {
      const pct = this.bucketPercent(params.deviceId, String(rollout._id));
      if (pct >= rollout.percentage) {
        return false;
      }
    }

    return true;
  }

  /** Deterministic 0–99 bucket from device + rollout id. */
  bucketPercent(deviceId: string, rolloutId: string): number {
    const h = createHash('sha256')
      .update(`${deviceId}:${rolloutId}`)
      .digest();
    return h.readUInt32BE(0) % 100;
  }
}
