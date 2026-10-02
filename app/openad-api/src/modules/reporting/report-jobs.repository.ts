import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import { ReportJobRecord, ReportJobDocument } from './report-job.schema';

@Injectable()
export class ReportJobsRepository extends AbstractRepository<ReportJobDocument> {
  constructor(
    @InjectModel(ReportJobRecord.name) model: Model<ReportJobDocument>
  ) {
    super(model);
  }

  async findByJobId(jobId: string): Promise<ReportJobDocument | null> {
    return this.findOne({ jobId });
  }

  async findRecentByCampaign(
    campaignId: string,
    limit = 50
  ): Promise<ReportJobDocument[]> {
    return this.model
      .find({ campaignId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /** Terminal jobs whose export object is older than `cutoff` (by last job update). */
  async findStaleReportExports(
    cutoff: Date,
    limit: number
  ): Promise<Array<{ jobId: string; filePath: string }>> {
    const rows = await this.model
      .find({
        status: { $in: ['ready', 'failed'] },
        filePath: { $regex: /^r2:reports\// },
        updatedAt: { $lt: cutoff },
      })
      .limit(limit)
      .select('jobId filePath')
      .lean()
      .exec();
    return rows
      .filter((r) => r.filePath != null)
      .map((r) => ({ jobId: r.jobId, filePath: r.filePath as string }));
  }

  async clearReportExportPaths(jobId: string): Promise<void> {
    await this.model
      .updateOne(
        { jobId },
        { $set: { filePath: null, downloadPath: null } }
      )
      .exec();
  }
}
