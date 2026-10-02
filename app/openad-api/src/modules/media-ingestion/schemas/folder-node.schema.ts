import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FolderNodeDocument = HydratedDocument<FolderNode>;

@Schema({ timestamps: true, collection: 'folder_nodes' })
export class FolderNode {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null, index: true })
  parentId!: string | null;

  @Prop({ type: String, required: true })
  materializedPath!: string;

  @Prop({ type: String, default: null, index: true })
  campaignId!: string | null;

  @Prop({ type: Boolean, default: false })
  isSystemLocked!: boolean;
}

export const FolderNodeSchema = SchemaFactory.createForClass(FolderNode);

FolderNodeSchema.index({ parentId: 1, name: 1 }, { unique: false });
FolderNodeSchema.index({ materializedPath: 1 }, { unique: true });
