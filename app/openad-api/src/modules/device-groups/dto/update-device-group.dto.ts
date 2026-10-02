import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateDeviceGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUUID()
  profileId?: string;
}
