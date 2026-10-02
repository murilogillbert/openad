import { ApiProperty } from '@nestjs/swagger';

export class MediaValidationErrorDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ required: false })
  details?: Record<string, string>;
}
