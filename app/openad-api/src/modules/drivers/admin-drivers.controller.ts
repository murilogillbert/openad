import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { extractFleetAuditFromRequest } from '../../infrastructure/logging/fleet-audit.context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DriverDirectoryService } from './driver-directory.service';
import { DeviceDriverBindingService } from './device-driver-binding.service';
import { BindDriverDto } from './dto/bind-driver.dto';

/**
 * Pesquisa de motorista no cadastro do ecossistema.
 *
 * Rota nova, so para o portal de administracao. Nenhum aplicativo em revisao na loja a
 * consome.
 */
@ApiTags('admin', 'drivers')
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(private readonly diretorio: DriverDirectoryService) {}

  @Get('search')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Pesquisa motorista por nome ou e-mail (cadastro do ecossistema)',
  })
  search(@Query('q') q?: string) {
    return this.diretorio.pesquisar(q ?? '');
  }
}

/**
 * Vinculo de motorista por aparelho.
 *
 * Controller separado do `AdminDevicesController` para nao arrastar `PrismaService` e o
 * modulo de veiculos para dentro do modulo de aparelhos — `DevicesModule` e
 * `VehiclesModule` ja se importam em `forwardRef` mutuo, e somar uma terceira aresta ali
 * seria convidar ciclo de injecao.
 */
@ApiTags('admin', 'devices', 'drivers')
@Controller('admin/devices')
export class AdminDeviceDriverController {
  constructor(private readonly binding: DeviceDriverBindingService) {}

  @Get(':deviceId/driver')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Motorista vinculado ao aparelho, com o repasse combinado' })
  consultar(@Param('deviceId') deviceId: string) {
    return this.binding.consultar(deviceId);
  }

  @Put(':deviceId/driver')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Vincula motorista ao veiculo do aparelho (409 se o aparelho nao estiver pareado)',
  })
  vincular(
    @Param('deviceId') deviceId: string,
    @Body() dto: BindDriverDto,
    @Req() req: Request
  ) {
    return this.binding.vincular(
      deviceId,
      dto.driverUserId,
      extractFleetAuditFromRequest(req)
    );
  }

  @Delete(':deviceId/driver')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desvincula o motorista; a veiculacao continua' })
  desvincular(@Param('deviceId') deviceId: string, @Req() req: Request) {
    return this.binding.desvincular(
      deviceId,
      extractFleetAuditFromRequest(req)
    );
  }
}
