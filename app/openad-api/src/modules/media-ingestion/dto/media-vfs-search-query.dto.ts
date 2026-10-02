import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MediaVfsSearchQueryDto {
  @ApiProperty({ description: 'Folder whose subtree is searched (recursive)' })
  @IsString()
  @IsNotEmpty()
  scopeFolderId!: string;

  @ApiProperty({ description: 'Search text (matches folder names and file names)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  q!: string;
}
