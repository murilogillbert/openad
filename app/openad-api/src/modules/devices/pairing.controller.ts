import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PairingBindDto, PairingRegisterDto } from './dto/pairing.dto';
import { PairingService } from './pairing.service';

@ApiTags('devices', 'pairing')
@Controller('devices')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  @Post('pairing/register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register pending device hardware fingerprint (003)' })
  register(@Body() dto: PairingRegisterDto) {
    return this.pairing.register(dto);
  }

  @Post('pairing/bind')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete pairing with one-time secret (003)' })
  bind(@Body() dto: PairingBindDto) {
    return this.pairing.bind(dto);
  }
}
