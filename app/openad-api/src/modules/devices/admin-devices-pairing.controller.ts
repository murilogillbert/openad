import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PendingPairingListResponse } from '@openad/api-contracts';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DevicesRepository } from './devices.repository';
import { PairingService } from './pairing.service';

@ApiTags('admin', 'devices', 'pairing')
@Controller('admin/devices')
export class AdminDevicesPairingController {
  constructor(
    private readonly pairing: PairingService,
    private readonly devices: DevicesRepository
  ) {}

  @Get('pending-pairings')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List devices in Pending lifecycle (003 pairing queue)' })
  async listPendingPairings(): Promise<PendingPairingListResponse> {
    const docs = await this.devices.findPendingPairing();
    return {
      data: docs.map((d) => ({
        deviceId: d.deviceId,
        serialNumber: d.serialNumber,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  @Post(':deviceId/pairing-secret')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate one-time pairing secret for pending device (003)' })
  generateSecret(@Param('deviceId') deviceId: string, @Req() _req: Request) {
    void _req;
    return this.pairing.generateSecret(deviceId);
  }

  /**
   * Devolve o aparelho para `Pending` para poder parear de novo.
   *
   * Existe porque `generateSecret` exige `Pending` e nao havia nenhuma saida pela interface:
   * tablet reinstalado ficava preso em `Active`, sem como receber codigo novo.
   */
  @Post(':deviceId/pairing-reset')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devolve o aparelho para Pending, liberando novo pareamento' })
  reiniciarPareamento(@Param('deviceId') deviceId: string) {
    return this.pairing.reiniciarPareamento(deviceId);
  }

  /**
   * Remove o registro do aparelho. Recusa com 409 se ele estiver vinculado a um veiculo.
   */
  @Delete(':deviceId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Exclui o registro do aparelho e os rastros de pareamento' })
  excluirRegistro(@Param('deviceId') deviceId: string) {
    return this.pairing.excluirRegistro(deviceId);
  }

  /**
   * Manutencao: remove solicitacoes `Pending` que apontam para aparelho inexistente.
   *
   * Producao acumulou esses orfaos por um defeito de ordem de insercao no `register`, ja
   * corrigido; a rota existe para limpar o que ficou e nao depender de acesso ao banco.
   */
  @Post('pairing-requests/cleanup-orphans')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Limpa solicitacoes de pareamento orfas' })
  limparOrfas() {
    return this.pairing.limparSolicitacoesOrfas();
  }
}
