import { IsOptional, IsString } from 'class-validator';

export class ScreenshotUploadDto {
  @IsString()
  imageBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
