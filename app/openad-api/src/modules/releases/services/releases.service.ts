import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import type {
  LatestStableManifestResponse,
  DeviceUpdateManifestResponse,
} from '@openad/api-contracts';
import { AppRelease, AppReleaseDocument } from '../schemas/app-release.schema';
import { RolloutRecord, RolloutDocument } from '../schemas/rollout.schema';
import { ReleaseAuditService } from './release-audit.service';
import { ReleasePublicationService } from './release-publication.service';
import { ReleasesStorageService } from './releases-storage.service';
import { ReleasesUrlService } from './releases-url.service';
import { RolloutEligibilityService } from './rollout-eligibility.service';
import { DevicesRepository } from '../../devices/devices.repository';
import { UsersService } from '../../auth/users.service';

@Injectable()
export class ReleasesService {
  constructor(
    @InjectModel(AppRelease.name)
    private readonly releases: Model<AppReleaseDocument>,
    @InjectModel(RolloutRecord.name)
    private readonly rollouts: Model<RolloutDocument>,
    private readonly storage: ReleasesStorageService,
    private readonly publication: ReleasePublicationService,
    private readonly audit: ReleaseAuditService,
    private readonly urls: ReleasesUrlService,
    private readonly rolloutEligibility: RolloutEligibilityService,
    private readonly devices: DevicesRepository,
    private readonly users: UsersService
  ) {}

  async createReleaseFromUpload(params: {
    buffer: Buffer;
    originalFilename: string;
    versionIdentifier: string;
    buildNumber?: number | null;
    releaseNotes?: string | null;
    uploadedByUserId: string;
  }): Promise<AppReleaseDocument> {
    const ext = params.originalFilename.toLowerCase();
    if (!ext.endsWith('.apk')) {
      throw new BadRequestException('Only .apk files are accepted');
    }
    const sha256Hex = createHash('sha256').update(params.buffer).digest('hex');
    const key = this.storage.objectKeyForUpload();
    const storageRef = await this.storage.saveApkBuffer({
      buffer: params.buffer,
      key,
    });
    const doc = await this.releases.create({
      versionIdentifier: params.versionIdentifier.trim(),
      buildNumber: params.buildNumber ?? null,
      storageRef,
      sha256Hex,
      sizeBytes: params.buffer.length,
      status: 'uploaded',
      channel: 'stable',
      artifactAccessToken: randomUUID(),
      originalFilename: params.originalFilename,
      releaseNotes: params.releaseNotes?.trim() || '',
      uploadedByUserId: params.uploadedByUserId,
    });

    await this.audit.record({
      actorUserId: params.uploadedByUserId,
      action: 'release.upload',
      subjectId: String(doc._id),
      metadata: { versionIdentifier: doc.versionIdentifier },
    });

    return doc;
  }

  async findById(id: string): Promise<AppReleaseDocument | null> {
    return this.releases.findById(id).exec();
  }

  async findByAccessToken(token: string): Promise<AppReleaseDocument | null> {
    return this.releases.findOne({ artifactAccessToken: token }).exec();
  }

  async listRecent(limit = 50): Promise<
    Array<
      AppReleaseDocument & {
        installedCount: number;
        uploadedBy?: { userId: string; displayName: string; email: string };
        isLatestStable: boolean;
        /** True when a paused/active rollout exists for this build (excludes draft-only rollouts). */
        hasStagedRollout: boolean;
      }
    >
  > {
    const rows = await this.releases.find().sort({ createdAt: -1 }).limit(limit).exec();
    const stable = await this.publication.getStablePublication();
    const stableId = stable?.releaseId ? String(stable.releaseId) : null;

    const relIds = rows.map((r) => r._id);
    const stagingRollouts =
      relIds.length === 0
        ? []
        : await this.rollouts
            .find({
              releaseId: { $in: relIds },
              status: { $in: ['active', 'paused'] },
            })
            .select('releaseId')
            .lean()
            .exec();
    const stagedForRelease = new Set(
      stagingRollouts.map((x) => String(x.releaseId))
    );

    const uploaderIds = rows.map((r) => r.uploadedByUserId);
    const uploaders = await this.users.findByUserIds(uploaderIds);
    const uploaderById = new Map(
      uploaders.map((u) => [
        u.userId,
        { userId: u.userId, displayName: u.displayName, email: u.email },
      ])
    );

    const withCounts = await Promise.all(
      rows.map(async (r) => {
        const installedCount = await this.devices.countInstalledVersion(
          r.versionIdentifier
        );
        return Object.assign(r, {
          installedCount,
          uploadedBy: uploaderById.get(r.uploadedByUserId),
          isLatestStable: stableId ? String(r._id) === stableId : false,
          hasStagedRollout: stagedForRelease.has(String(r._id)),
        });
      })
    );
    return withCounts;
  }

  async listFieldReleaseNotes(): Promise<
    Array<{
      versionIdentifier: string;
      releaseNotes: string;
      createdAt: string | null;
    }>
  > {
    const rows = await this.releases
      .find({ status: { $ne: 'revoked' } })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('versionIdentifier releaseNotes createdAt')
      .lean()
      .exec();
    return rows.map((r) => {
      const doc = r as unknown as {
        versionIdentifier: string;
        releaseNotes?: string;
        createdAt?: Date;
      };
      return {
        versionIdentifier: doc.versionIdentifier,
        releaseNotes: doc.releaseNotes || '',
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
      };
    });
  }

  async getMdmMetrics(): Promise<{
    latestStableVersion: string | null;
    totalOnLatest: number;
    pendingNotOnLatest: number;
    openRolloutWaves: number;
  }> {
    const openRolloutWaves = await this.rollouts.countDocuments({
      status: { $in: ['active', 'paused'] },
    });
    const pub = await this.publication.getStablePublication();
    if (!pub) {
      return {
        latestStableVersion: null,
        totalOnLatest: 0,
        pendingNotOnLatest: 0,
        openRolloutWaves,
      };
    }
    const rel = await this.releases.findById(pub.releaseId).exec();
    if (!rel || rel.status === 'revoked') {
      return {
        latestStableVersion: null,
        totalOnLatest: 0,
        pendingNotOnLatest: 0,
        openRolloutWaves,
      };
    }
    const latest = rel.versionIdentifier;
    const totalOnLatest = await this.devices.countInstalledVersion(latest);
    const pendingNotOnLatest = await this.devices.countNotOnLatestVersion(
      (a, b) => this.compareVersions(a, b),
      latest
    );
    return {
      latestStableVersion: latest,
      totalOnLatest,
      pendingNotOnLatest,
      openRolloutWaves,
    };
  }

  async revokeRelease(
    releaseId: string,
    actorUserId: string
  ): Promise<{ ok: true }> {
    const pub = await this.publication.getStablePublication();
    if (pub && String(pub.releaseId) === releaseId) {
      throw new BadRequestException(
        'Cannot revoke the current latest stable. Publish a different release as stable first, then revoke this one.'
      );
    }
    const rel = await this.releases.findById(releaseId).exec();
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    if (rel.status === 'revoked') {
      return { ok: true };
    }
    await this.rollouts.updateMany(
      {
        releaseId: new Types.ObjectId(releaseId),
        status: { $in: ['active', 'draft', 'paused'] },
      },
      { $set: { status: 'cancelled', endedAt: new Date() } }
    );
    rel.status = 'revoked';
    await rel.save();
    await this.audit.record({
      actorUserId,
      action: 'release.revoke',
      subjectId: String(rel._id),
      metadata: { versionIdentifier: rel.versionIdentifier },
    });
    return { ok: true };
  }

  async getLatestStableManifest(): Promise<LatestStableManifestResponse | null> {
    const pub = await this.publication.getStablePublication();
    if (!pub) {
      return null;
    }
    const rel = await this.releases.findById(pub.releaseId).exec();
    if (!rel || rel.status === 'revoked') {
      return null;
    }
    return {
      channel: 'stable',
      latest: {
        versionIdentifier: rel.versionIdentifier,
        downloadUrl: this.urls.buildArtifactUrl(rel.artifactAccessToken),
        integrity: { algorithm: 'sha256', value: rel.sha256Hex },
        sizeBytes: rel.sizeBytes,
      },
    };
  }

  async getDeviceUpdateManifest(params: {
    deviceId: string;
    currentVersionIdentifier: string;
  }): Promise<DeviceUpdateManifestResponse> {
    const { device, rollout, targetRelease } =
      await this.rolloutEligibility.resolveUpdateTarget(params.deviceId);

    const current = {
      versionIdentifier:
        device.currentRelease?.versionIdentifier ??
        params.currentVersionIdentifier,
    };

    if (!rollout || !targetRelease) {
      return {
        deviceId: params.deviceId,
        current,
        eligible: false,
        target: null,
      };
    }

    const eligible = await this.rolloutEligibility.isDeviceEligible({
      deviceId: params.deviceId,
      rollout,
      device,
    });

    if (!eligible) {
      return {
        deviceId: params.deviceId,
        current,
        eligible: false,
        target: null,
      };
    }

    if (this.isVersionUpToDate(current.versionIdentifier, targetRelease.versionIdentifier)) {
      return {
        deviceId: params.deviceId,
        current,
        eligible: true,
        target: null,
      };
    }

    return {
      deviceId: params.deviceId,
      current,
      eligible: true,
      target: {
        versionIdentifier: targetRelease.versionIdentifier,
        downloadUrl: this.urls.buildArtifactUrl(targetRelease.artifactAccessToken),
        integrity: { algorithm: 'sha256', value: targetRelease.sha256Hex },
        sizeBytes: targetRelease.sizeBytes,
      },
    };
  }

  /** Lexical semver-like compare: returns true if a is >= b for dotted numeric segments. */
  isVersionUpToDate(current: string, target: string): boolean {
    return this.compareVersions(current, target) >= 0;
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) {
        return da - db;
      }
    }
    return 0;
  }

  async createRollout(params: {
    releaseId: string;
    deviceGroupIds: string[];
    percentage: number | null;
    actorUserId: string;
  }): Promise<RolloutDocument> {
    const rel = await this.releases.findById(params.releaseId).exec();
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    if (rel.status === 'revoked') {
      throw new BadRequestException('Cannot roll out a revoked release');
    }
    const r = await this.rollouts.create({
      releaseId: new Types.ObjectId(rel._id),
      status: 'draft',
      deviceGroupIds: params.deviceGroupIds,
      percentage: params.percentage,
      startedAt: null,
      endedAt: null,
    });
    await this.audit.record({
      actorUserId: params.actorUserId,
      action: 'rollout.create',
      subjectId: String(r._id),
      metadata: { releaseId: params.releaseId },
    });
    return r;
  }

  async setRolloutStatus(params: {
    rolloutId: string;
    status: RolloutRecord['status'];
    actorUserId: string;
  }): Promise<RolloutDocument | null> {
    if (params.status === 'active') {
      const others = await this.rollouts
        .find({
          _id: { $ne: new Types.ObjectId(params.rolloutId) },
          status: 'active',
        })
        .exec();
      for (const o of others) {
        await this.rollouts
          .findByIdAndUpdate(o._id, { $set: { status: 'paused' } })
          .exec();
        await this.audit.record({
          actorUserId: params.actorUserId,
          action: 'rollout.pause',
          subjectId: String(o._id),
          metadata: { reason: 'single_active_rollout' },
        });
      }
    }

    const patch: Partial<RolloutRecord> = { status: params.status };
    if (params.status === 'active') {
      patch.startedAt = new Date();
    }
    if (params.status === 'completed' || params.status === 'cancelled') {
      patch.endedAt = new Date();
    }
    const r = await this.rollouts
      .findByIdAndUpdate(params.rolloutId, { $set: patch }, { new: true })
      .exec();
    if (r) {
      const action =
        params.status === 'active'
          ? 'rollout.activate'
          : params.status === 'paused'
            ? 'rollout.pause'
            : 'rollout.complete';
      await this.audit.record({
        actorUserId: params.actorUserId,
        action,
        subjectId: String(r._id),
      });
    }
    return r;
  }

  async listRollouts(): Promise<RolloutDocument[]> {
    return this.rollouts.find().sort({ createdAt: -1 }).limit(100).exec();
  }
}
