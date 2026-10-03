import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReportJobDocument = HydratedDocument<ReportJobRecord>;

@Schema({ collection: 'report_jobs', timestamps: true })
export class ReportJobRecord {
  @Prop({ type: String, required: true })
  jobId!: string;

  @Prop({ required: true })
  campaignId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['json', 'csv', 'pdf'],
  })
  format!: 'json' | 'csv' | 'pdf';

  @Prop({
    type: String,
    required: true,
    enum: ['queued', 'processing', 'ready', 'failed'],
  })
  status!: 'queued' | 'processing' | 'ready' | 'failed';

  @Prop({ type: String, default: null })
  filePath!: string | null;

  @Prop({ type: String, default: null })
  downloadPath!: string | null;

  @Prop({ type: Number, default: null })
  impressionCount!: number | null;

  /** Total faturavel do relatorio, em centavos inteiros. */
  @Prop({ type: Number, default: null })
  totalBillableValueCents!: number | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: String, default: null })
  requestedByUserId!: string | null;
}

export const ReportJobSchema = SchemaFactory.createForClass(ReportJobRecord);

ReportJobSchema.index({ jobId: 1 }, { unique: true, name: 'jobId_1' });

ReportJobSchema.index({ campaignId: 1, createdAt: -1 });
ReportJobSchema.index({ status: 1, createdAt: -1 });
