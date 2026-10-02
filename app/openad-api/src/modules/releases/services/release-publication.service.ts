import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppRelease, AppReleaseDocument } from '../schemas/app-release.schema';
import {
  ReleasePublication,
  ReleasePublicationDocument,
} from '../schemas/release-publication.schema';
import { ReleaseAuditService } from './release-audit.service';

@Injectable()
export class ReleasePublicationService {
  constructor(
    @InjectModel(AppRelease.name)
    private readonly releases: Model<AppReleaseDocument>,
    @InjectModel(ReleasePublication.name)
    private readonly publications: Model<ReleasePublicationDocument>,
    private readonly audit: ReleaseAuditService
  ) {}

  async publishLatestStable(params: {
    releaseId: string;
    publishedByUserId: string;
  }): Promise<ReleasePublicationDocument> {
    const rel = await this.releases.findById(params.releaseId).exec();
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    if (rel.status === 'revoked') {
      throw new BadRequestException('Cannot publish a revoked release');
    }
    rel.status = 'approved';
    await rel.save();

    const pub = await this.publications.findOneAndUpdate(
      { channel: 'stable' },
      {
        $set: {
          releaseId: new Types.ObjectId(rel._id),
          publishedAt: new Date(),
          publishedByUserId: params.publishedByUserId,
        },
      },
      { upsert: true, new: true }
    );

    await this.audit.record({
      actorUserId: params.publishedByUserId,
      action: 'release.publish_latest',
      subjectId: String(rel._id),
      metadata: { channel: 'stable' },
    });

    return pub!;
  }

  async getStablePublication(): Promise<ReleasePublicationDocument | null> {
    return this.publications.findOne({ channel: 'stable' }).exec();
  }
}
