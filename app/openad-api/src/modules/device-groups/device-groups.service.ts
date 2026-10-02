import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type {
  ConfigSyncCompleteEvent,
  DeviceGroupResponse,
  GroupMembershipUpdateResponse,
  Paginated,
} from '@openad/api-contracts';
import { ConfigurationProfilesRepository } from '../configuration-profiles/configuration-profiles.repository';
import { ConfigurationProfilesService } from '../configuration-profiles/configuration-profiles.service';
import { DevicesRepository } from '../devices/devices.repository';
import { CreateDeviceGroupDto } from './dto/create-device-group.dto';
import { UpdateDeviceGroupDto } from './dto/update-device-group.dto';
import type { SyncWindowsUpdateDto } from './dto/sync-windows-update.dto';
import { DeviceGroupsRepository } from './device-groups.repository';
import type { DeviceGroupDocument } from './device-group.schema';

@Injectable()
export class DeviceGroupsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly groups: DeviceGroupsRepository,
    private readonly profiles: ConfigurationProfilesRepository,
    private readonly profileService: ConfigurationProfilesService,
    private readonly devices: DevicesRepository
  ) {
    this.logger.setContext(DeviceGroupsService.name);
  }

  async create(dto: CreateDeviceGroupDto): Promise<DeviceGroupResponse> {
    const profile = await this.profiles.findById(dto.profileId);
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    const nameClash = await this.groups.findByName(dto.name);
    if (nameClash) {
      throw new ConflictException({
        code: 'GROUP_NAME_CONFLICT',
        message: 'Group name already exists',
      });
    }
    const groupId = randomUUID();
    const doc = await this.groups.create({
      groupId,
      name: dto.name,
      profileId: dto.profileId,
    });
    return this.toResponse(doc, 0);
  }

  async findAll(
    page = 1,
    limit = 50
  ): Promise<Paginated<DeviceGroupResponse>> {
    const { data, total } = await this.groups.findAll({ page, limit });
    const withCounts = await Promise.all(
      data.map(async (g) => {
        const memberCount = await this.groups.getMemberCount(g.groupId);
        return this.toResponse(g, memberCount);
      })
    );
    return {
      data: withCounts,
      pagination: { total, page, limit },
    };
  }

  async findById(groupId: string): Promise<DeviceGroupResponse> {
    const doc = await this.groups.findById(groupId);
    if (!doc) throw new NotFoundException('Group not found');
    const memberCount = await this.groups.getMemberCount(groupId);
    return this.toResponse(doc, memberCount);
  }

  async updateSyncWindows(
    groupId: string,
    dto: SyncWindowsUpdateDto
  ): Promise<DeviceGroupResponse> {
    const existing = await this.groups.findById(groupId);
    if (!existing) throw new NotFoundException('Group not found');
    const nextRev = (existing.configRevision ?? 0) + 1;
    const rules = dto.rules.map((r) => ({
      ruleId: randomUUID(),
      startTime: r.startTime,
      endTime: r.endTime,
      daysOfWeek: r.daysOfWeek,
      sizeThresholdMb: r.sizeThresholdMb,
    }));
    const doc = await this.groups.updateById(groupId, {
      syncWindowRules: rules,
      configRevision: nextRev,
    });
    if (!doc) throw new NotFoundException('Group not found');
    await this.profileService.publishDeviceConfigToGroup(groupId);
    const memberCount = await this.groups.getMemberCount(groupId);
    return this.toResponse(doc, memberCount);
  }

  async update(
    groupId: string,
    dto: UpdateDeviceGroupDto
  ): Promise<DeviceGroupResponse> {
    const existing = await this.groups.findById(groupId);
    if (!existing) throw new NotFoundException('Group not found');
    if (dto.profileId) {
      const profile = await this.profiles.findById(dto.profileId);
      if (!profile) throw new NotFoundException('Profile not found');
    }
    if (dto.name && dto.name !== existing.name) {
      const clash = await this.groups.findByName(dto.name);
      if (clash) {
        throw new ConflictException({
          code: 'GROUP_NAME_CONFLICT',
          message: 'Group name already exists',
        });
      }
    }
    const doc = await this.groups.updateById(groupId, dto);
    if (!doc) throw new NotFoundException('Group not found');
    if (dto.profileId && dto.profileId !== existing.profileId) {
      await this.profileService.publishDeviceConfigToGroup(groupId);
    }
    const memberCount = await this.groups.getMemberCount(groupId);
    return this.toResponse(doc, memberCount);
  }

  async delete(groupId: string): Promise<void> {
    const existing = await this.groups.findById(groupId);
    if (!existing) throw new NotFoundException('Group not found');
    const members = await this.devices.findDeviceIdsByGroupId(groupId);
    await this.devices.updateGroupIdForDevices(members, null);
    await this.groups.deleteById(groupId);
  }

  async updateMembers(
    groupId: string,
    deviceIds: string[]
  ): Promise<GroupMembershipUpdateResponse> {
    const group = await this.groups.findById(groupId);
    if (!group) throw new NotFoundException('Group not found');

    const previousMembers = await this.devices.findDeviceIdsByGroupId(groupId);
    const removedFromGroupIds: Record<string, string[]> = {};

    for (const id of deviceIds) {
      const dev = await this.devices.findByDeviceId(id);
      if (!dev) continue;
      if (dev.groupId && dev.groupId !== groupId) {
        const og = dev.groupId;
        if (!removedFromGroupIds[og]) removedFromGroupIds[og] = [];
        removedFromGroupIds[og].push(id);
      }
    }

    for (const id of previousMembers) {
      if (!deviceIds.includes(id)) {
        if (!removedFromGroupIds[groupId]) removedFromGroupIds[groupId] = [];
        removedFromGroupIds[groupId].push(id);
      }
    }

    await this.devices.clearGroupForDevicesNotInList(groupId, deviceIds);
    await this.devices.updateGroupIdForDevices(deviceIds, groupId);

    const addedDeviceIds = deviceIds.filter((id) => !previousMembers.includes(id));

    await this.profileService.publishDeviceConfigToGroup(groupId);

    const configSyncComplete: ConfigSyncCompleteEvent = {
      type: 'config_sync_complete',
      profileId: group.profileId,
      groupId,
      deviceCount: deviceIds.length,
      syncedAt: new Date().toISOString(),
    };

    this.logger.info(
      {
        event: 'device.group.members_update',
        groupId,
        added: addedDeviceIds.length,
      },
      'device group membership updated'
    );

    return {
      groupId,
      addedDeviceIds,
      removedFromGroupIds,
      triggeredConfigSync: true,
      configSyncComplete,
    };
  }

  private toResponse(
    doc: DeviceGroupDocument,
    memberCount?: number
  ): DeviceGroupResponse {
    const d = doc as DeviceGroupDocument & {
      createdAt?: Date;
      updatedAt?: Date;
    };
    return {
      groupId: doc.groupId,
      name: doc.name,
      profileId: doc.profileId,
      memberCount: memberCount ?? 0,
      createdAt: (d.createdAt ?? new Date()).toISOString(),
      updatedAt: (d.updatedAt ?? new Date()).toISOString(),
      ...(doc.syncWindowRules?.length
        ? { syncWindowRules: doc.syncWindowRules.map((r) => ({ ...r })) }
        : {}),
      configRevision: doc.configRevision ?? 0,
    };
  }
}
