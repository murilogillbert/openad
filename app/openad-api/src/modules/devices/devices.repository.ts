import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { Device, DeviceDocument } from './devices.schema';

@Injectable()
export class DevicesRepository extends AbstractRepository<DeviceDocument> {
  constructor(
    @InjectModel(Device.name) model: Model<DeviceDocument>
  ) {
    super(model);
  }

  async findBySerial(serialNumber: string): Promise<DeviceDocument | null> {
    return this.findOne({ serialNumber });
  }

  async findByDeviceId(deviceId: string): Promise<DeviceDocument | null> {
    return this.findOne({ deviceId });
  }

  async findByDeviceIds(deviceIds: string[]): Promise<DeviceDocument[]> {
    if (deviceIds.length === 0) return [];
    return this.model.find({ deviceId: { $in: deviceIds } }).exec();
  }

  /**
   * Admin helper: search devices by `deviceId` or `serialNumber` (prefix/contains).
   * Intended for operator tooling (single selection).
   */
  async searchByDeviceIdOrSerial(params: {
    query: string;
    limit?: number;
  }): Promise<Array<Pick<DeviceDocument, 'deviceId' | 'serialNumber' | 'boundVehicleId'>>> {
    const q = params.query.trim();
    if (q.length < 2) return [];
    const limit = Math.max(1, Math.min(params.limit ?? 20, 50));
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    const docs = await this.model
      .find({
        $or: [{ deviceId: re }, { serialNumber: re }],
      })
      .select('deviceId serialNumber boundVehicleId')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return docs as any;
  }

  async findByBoundVehicleIds(
    vehicleIds: string[]
  ): Promise<DeviceDocument[]> {
    if (vehicleIds.length === 0) return [];
    return this.model
      .find({ boundVehicleId: { $in: vehicleIds } })
      .exec();
  }

  /** 003 — devices awaiting technician bind (lifecycle Pending). */
  async findPendingPairing(
    limit = 200
  ): Promise<DeviceDocument[]> {
    return this.model
      .find({ lifecycleState: 'Pending' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /** Active devices bound to a vehicle (for schedule / asset URL rotation). */
  async findActiveBoundDeviceIds(): Promise<string[]> {
    const docs = await this.model
      .find({
        boundVehicleId: { $ne: null },
        lifecycleState: 'Active',
      })
      .select('deviceId')
      .lean()
      .exec();
    return docs.map((d) => d.deviceId);
  }

  async countByGroupId(groupId: string): Promise<number> {
    return this.model.countDocuments({ groupId }).exec();
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /** 010 — approximate reach: devices reporting installed version. */
  async countInstalledVersion(versionIdentifier: string): Promise<number> {
    return this.model.countDocuments({
      'currentRelease.versionIdentifier': versionIdentifier,
    }).exec();
  }

  /**
   * Devices with no reported app version, or a version strictly older than `latestVersion`
   * (lexicographic compare delegated to caller).
   */
  async countNotOnLatestVersion(
    compare: (a: string, b: string) => number,
    latestVersion: string
  ): Promise<number> {
    const docs = await this.model
      .find({})
      .select('currentRelease')
      .lean()
      .exec();
    let n = 0;
    for (const d of docs) {
      const cur = d.currentRelease?.versionIdentifier;
      if (!cur) {
        n++;
        continue;
      }
      if (compare(cur, latestVersion) < 0) {
        n++;
      }
    }
    return n;
  }

  async findDeviceIdsByGroupId(groupId: string): Promise<string[]> {
    const docs = await this.model
      .find({ groupId })
      .select('deviceId')
      .lean()
      .exec();
    return docs.map((d) => d.deviceId);
  }

  async updateGroupIdForDevices(
    deviceIds: string[],
    groupId: string | null
  ): Promise<void> {
    if (deviceIds.length === 0) return;
    await this.model
      .updateMany({ deviceId: { $in: deviceIds } }, { $set: { groupId } })
      .exec();
  }

  async clearGroupForDevicesNotInList(
    groupId: string,
    keepDeviceIds: string[]
  ): Promise<void> {
    await this.model
      .updateMany(
        {
          groupId,
          deviceId: { $nin: keepDeviceIds },
        },
        { $set: { groupId: null } }
      )
      .exec();
  }
}
