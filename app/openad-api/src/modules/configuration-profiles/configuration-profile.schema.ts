import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ConnectivityMode } from '@openad/domain';

export type ConfigurationProfileDocument = HydratedDocument<ConfigurationProfile>;

@Schema({ _id: false })
class ExhibitionRulesSub {
  @Prop({ type: Number, required: true })
  maxLoopLengthSeconds!: number;

  @Prop({ type: Number, required: true })
  adToContentRatio!: number;
}

const ExhibitionRulesSchema = SchemaFactory.createForClass(ExhibitionRulesSub);

@Schema({ collection: 'configuration_profiles', timestamps: true })
export class ConfigurationProfile {
  @Prop({ required: true, unique: true })
  profileId!: string;

  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ type: ExhibitionRulesSchema, required: true })
  exhibitionRules!: {
    maxLoopLengthSeconds: number;
    adToContentRatio: number;
  };

  @Prop({ type: String, required: true, enum: ['Economy', 'Premium'] })
  connectivityMode!: ConnectivityMode;

  @Prop({ type: Number, required: true })
  commercialTierMultiplier!: number;

  @Prop({ required: true, default: false })
  isDefault!: boolean;
}

export const ConfigurationProfileSchema =
  SchemaFactory.createForClass(ConfigurationProfile);

ConfigurationProfileSchema.index({ isDefault: 1 });
