import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { ConfigurationProfileResponse, Paginated } from '@openad/api-contracts';
import type { DeviceConfigPayload } from '@openad/mqtt-contracts';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { DevicesRepository } from '../devices/devices.repository';
import { DeviceGroupsRepository } from '../device-groups/device-groups.repository';
import { NotificationService } from '../fleet-monitor/notification.service';
import { CreateConfigurationProfileDto } from './dto/create-configuration-profile.dto';
import { UpdateConfigurationProfileDto } from './dto/update-configuration-profile.dto';
import { ConfigurationProfilesRepository } from './configuration-profiles.repository';
import type { ConfigurationProfileDocument } from './configuration-profile.schema';

@Injectable()
export class ConfigurationProfilesService implements OnModuleInit {
  constructor(
    private readonly logger: PinoLogger,
    private readonly profiles: ConfigurationProfilesRepository,
    private readonly deviceGroups: DeviceGroupsRepository,
    private readonly devices: DevicesRepository,
    private readonly mqtt: MqttService,
    private readonly notifications: NotificationService
  ) {
    this.logger.setContext(ConfigurationProfilesService.name);
  }

  async onModuleInit(): Promise<void> {
    const existing = await this.profiles.findDefault();
    if (!existing) {
      const profileId = randomUUID();
      await this.profiles.create({
        profileId,
        name: 'System Default',
        exhibitionRules: { maxLoopLengthSeconds: 120, adToContentRatio: 3 },
        connectivityMode: 'Economy',
        commercialTierMultiplier: 1,
        isDefault: true,
      });
      this.logger.info(
        { event: 'profile.default_seeded', profileId },
        'seeded system default configuration profile'
      );
    }
  }

  async create(
    dto: CreateConfigurationProfileDto
  ): Promise<ConfigurationProfileResponse> {
    if (dto.commercialTierMultiplier > 10) {
      throw new BadRequestException(
        'commercialTierMultiplier must not exceed 10'
      );
    }
    const dup = await this.profiles.findByName(dto.name);
    if (dup) {
      throw new ConflictException({
        code: 'PROFILE_NAME_CONFLICT',
        message: 'Profile name already exists',
      });
    }
    const profileId = randomUUID();
    const doc = await this.profiles.create({
      profileId,
      name: dto.name,
      exhibitionRules: {
        maxLoopLengthSeconds: dto.exhibitionRules.maxLoopLengthSeconds,
        adToContentRatio: dto.exhibitionRules.adToContentRatio,
      },
      connectivityMode: dto.connectivityMode,
      commercialTierMultiplier: dto.commercialTierMultiplier,
      isDefault: false,
    });
    return this.toResponse(doc);
  }

  async findAll(
    page = 1,
    limit = 50
  ): Promise<Paginated<ConfigurationProfileResponse>> {
    const { data, total } = await this.profiles.findAll({ page, limit });
    return {
      data: data.map((d) => this.toResponse(d)),
      pagination: { total, page, limit },
    };
  }

  async findById(profileId: string): Promise<ConfigurationProfileResponse> {
    const doc = await this.profiles.findById(profileId);
    if (!doc) throw new NotFoundException('Profile not found');
    return this.toResponse(doc);
  }

  async update(
    profileId: string,
    dto: UpdateConfigurationProfileDto
  ): Promise<ConfigurationProfileResponse> {
    const existing = await this.profiles.findById(profileId);
    if (!existing) throw new NotFoundException('Profile not found');
    if (dto.name && dto.name !== existing.name) {
      const dup = await this.profiles.findByName(dto.name);
      if (dup) {
        throw new ConflictException({
          code: 'PROFILE_NAME_CONFLICT',
          message: 'Profile name already exists',
        });
      }
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.exhibitionRules !== undefined) {
      patch.exhibitionRules = {
        ...existing.exhibitionRules,
        ...dto.exhibitionRules,
      };
    }
    if (dto.connectivityMode !== undefined) {
      patch.connectivityMode = dto.connectivityMode;
    }
    if (dto.commercialTierMultiplier !== undefined) {
      if (dto.commercialTierMultiplier > 10) {
        throw new BadRequestException(
          'commercialTierMultiplier must not exceed 10'
        );
      }
      patch.commercialTierMultiplier = dto.commercialTierMultiplier;
    }
    const doc = await this.profiles.updateById(profileId, patch as never);
    if (!doc) throw new NotFoundException('Profile not found');
    const groups = await this.deviceGroups.findByProfileId(profileId);
    for (const g of groups) {
      await this.publishDeviceConfigToGroup(g.groupId);
    }
    return this.toResponse(doc);
  }

  async delete(profileId: string): Promise<void> {
    const existing = await this.profiles.findById(profileId);
    if (!existing) throw new NotFoundException('Profile not found');
    if (existing.isDefault) {
      throw new ConflictException({
        code: 'CANNOT_DELETE_DEFAULT',
        message: 'Cannot delete the system default profile',
      });
    }
    const defaultProfile = await this.profiles.findDefault();
    if (!defaultProfile || defaultProfile.profileId === profileId) {
      throw new ConflictException({
        code: 'CANNOT_DELETE_DEFAULT',
        message: 'No default profile available for reassignment',
      });
    }
    const affectedGroups = await this.deviceGroups.findByProfileId(profileId);
    await this.deviceGroups.reassignProfileOnGroups(
      profileId,
      defaultProfile.profileId
    );
    await this.profiles.deleteById(profileId);
    await this.notifications.alertAdmins(
      'system',
      'Configuration profile deleted',
      `Profile "${existing.name}" was deleted; groups reassigned to default.`,
      { deletedProfileId: profileId }
    );
    for (const g of affectedGroups) {
      await this.publishDeviceConfigToGroup(g.groupId);
    }
    this.logger.info(
      {
        event: 'profile.deleted',
        profileId,
        reassignedGroups: affectedGroups.length,
      },
      'configuration profile deleted and groups reassigned'
    );
  }

  async publishDeviceConfigToGroup(groupId: string): Promise<void> {
    const group = await this.deviceGroups.findById(groupId);
    if (!group) return;
    const profile = await this.profiles.findById(group.profileId);
    if (!profile) return;
    const deviceIds = await this.devices.findDeviceIdsByGroupId(groupId);
    const effectiveAt = new Date().toISOString();
    const payload: DeviceConfigPayload = {
      profileId: profile.profileId,
      exhibitionRules: profile.exhibitionRules,
      connectivityMode: profile.connectivityMode,
      commercialTierMultiplier: profile.commercialTierMultiplier,
      effectiveAt,
    };
    if (group.syncWindowRules?.length) {
      payload.syncWindows = group.syncWindowRules.map((r) => ({
        startTime: r.startTime,
        endTime: r.endTime,
        daysOfWeek: r.daysOfWeek,
        sizeThresholdMb: r.sizeThresholdMb,
      }));
      payload.configRevision = group.configRevision ?? 0;
    }
    for (const deviceId of deviceIds) {
      await this.mqtt.publishDeviceConfig(deviceId, payload);
    }
    this.logger.info(
      {
        event: 'profile.config.push',
        groupId,
        profileId: profile.profileId,
        deviceCount: deviceIds.length,
      },
      'pushed configuration profile to group devices'
    );
  }

  private toResponse(doc: ConfigurationProfileDocument): ConfigurationProfileResponse {
    const c = doc as ConfigurationProfileDocument & {
      createdAt?: Date;
      updatedAt?: Date;
    };
    return {
      profileId: doc.profileId,
      name: doc.name,
      exhibitionRules: doc.exhibitionRules,
      connectivityMode: doc.connectivityMode,
      commercialTierMultiplier: doc.commercialTierMultiplier,
      isDefault: doc.isDefault,
      createdAt: (c.createdAt ?? new Date()).toISOString(),
      updatedAt: (c.updatedAt ?? new Date()).toISOString(),
    };
  }
}
