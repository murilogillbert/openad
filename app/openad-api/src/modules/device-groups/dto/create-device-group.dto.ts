import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDeviceGroupDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsUUID()
  profileId!: string;
}
