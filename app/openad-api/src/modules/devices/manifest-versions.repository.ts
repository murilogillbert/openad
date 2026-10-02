import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ManifestAssetRow } from './manifest-delta.util';
import {
  ManifestVersionRecord,
  type ManifestVersionDocument,
} from './schemas/manifest-version.schema';

@Injectable()
export class ManifestVersionsRepository {
  constructor(
    @InjectModel(ManifestVersionRecord.name)
    private readonly model: Model<ManifestVersionDocument>
  ) {}

  async findLatest(): Promise<{
    manifestVersion: number;
    assets: ManifestAssetRow[];
  } | null> {
    const doc = await this.model
      .findOne()
      .sort({ manifestVersion: -1 })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      manifestVersion: doc.manifestVersion,
      assets: doc.assets as ManifestAssetRow[],
    };
  }

  async findByVersion(
    manifestVersion: number
  ): Promise<{ manifestVersion: number; assets: ManifestAssetRow[] } | null> {
    const doc = await this.model
      .findOne({ manifestVersion })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      manifestVersion: doc.manifestVersion,
      assets: doc.assets as ManifestAssetRow[],
    };
  }

  /** Inserts the next monotonic version (for tests / ops seeding). */
  async createNextVersion(assets: ManifestAssetRow[]): Promise<number> {
    const last = await this.model
      .findOne()
      .sort({ manifestVersion: -1 })
      .select('manifestVersion')
      .lean()
      .exec();
    const next = (last?.manifestVersion ?? 0) + 1;
    await this.model.create({
      manifestVersion: next,
      assets,
      generatedAt: new Date(),
    });
    return next;
  }
}
