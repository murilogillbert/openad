import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsNumber, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateConfigurationProfileDto } from './dto/create-configuration-profile.dto';
import { UpdateConfigurationProfileDto } from './dto/update-configuration-profile.dto';
import { ConfigurationProfilesService } from './configuration-profiles.service';

class ProfileListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

@ApiTags('configuration-profiles')
@Controller('configuration-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class ConfigurationProfilesController {
  constructor(private readonly profiles: ConfigurationProfilesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create configuration profile' })
  create(@Body() dto: CreateConfigurationProfileDto) {
    return this.profiles.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List configuration profiles' })
  findAll(@Query() query: ProfileListQueryDto) {
    return this.profiles.findAll(query.page ?? 1, query.limit ?? 50);
  }

  @Get(':profileId')
  @ApiOperation({ summary: 'Get profile by id' })
  findOne(@Param('profileId') profileId: string) {
    return this.profiles.findById(profileId);
  }

  @Patch(':profileId')
  @ApiOperation({ summary: 'Update profile' })
  update(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateConfigurationProfileDto
  ) {
    return this.profiles.update(profileId, dto);
  }

  @Delete(':profileId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete profile' })
  async remove(@Param('profileId') profileId: string): Promise<void> {
    await this.profiles.delete(profileId);
  }
}
