import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { isInternalRole, ownerFilterFor } from '../auth/access-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MediaIngestionService } from './media-ingestion.service';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaListQueryDto } from './dto/media-list-query.dto';

const uploadDir = path.join(os.tmpdir(), 'openad-media-upload');

/** Principal autenticado, nas duas origens de token (equipe interna e anunciante). */
type UsuarioAutenticado = { userId?: string; role?: string };

@ApiTags('media-ingestion')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaIngestionController {
  constructor(private readonly mediaIngestion: MediaIngestionService) {}

  @Post('upload')
  @HttpCode(201)
  @Throttle({ mediaUpload: { limit: 100, ttl: 60_000 } })
  @Roles('fleet_admin', 'super_admin')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload and ingest a video advertisement' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_req, _file, cb) => {
          await fs.mkdir(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}-${file.originalname.replace(/[^\w.-]/g, '_')}`);
        },
      }),
      limits: { fileSize: 524_288_000 },
    })
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
    @Req() req: Request
  ) {
    const u = req.user as UsuarioAutenticado | undefined;
    const tempPath = file.path;
    try {
      const doc = await this.mediaIngestion.ingestUploadedFile({
        tempPath,
        originalFilename: file.originalname,
        byteLength: file.size,
        dto,
        uploadedBy: u?.userId,
        // Midia subida pela equipe interna nasce sem dono, como as campanhas internas.
        // `ownerFilterFor` devolve `{}` para papel interno, entao o filtro nao olha este campo
        // nesse caso; gravar o operador aqui esconderia a midia dos colegas dele.
        ownerUserId: isInternalRole(u?.role) ? null : (u?.userId ?? null),
      });
      return { success: true, data: doc };
    } catch (e) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Catalogo de midia, escopado pelo dono.
   *
   * `advertiser` entra na lista de papeis porque o anunciante precisa ver a **propria** midia;
   * o que separa um do outro nao e o papel na rota, e o `ownerFilterFor` na consulta: equipe
   * interna recebe filtro vazio, anunciante recebe `{ ownerUserId }`.
   */
  @Get()
  @Roles(
    'fleet_admin',
    'super_admin',
    'campaign_manager',
    'fleet_operator',
    'advertiser'
  )
  @ApiOperation({ summary: 'List active media catalog entries (scoped by owner)' })
  async list(@Query() query: MediaListQueryDto, @Req() req: Request) {
    const u = req.user as UsuarioAutenticado | undefined;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.mediaIngestion.listCatalog({
      page,
      limit,
      scope: ownerFilterFor({ userId: u?.userId, role: u?.role }),
    });
  }

  @Get(':mediaId')
  @Roles(
    'fleet_admin',
    'super_admin',
    'campaign_manager',
    'fleet_operator',
    'advertiser'
  )
  @ApiOperation({ summary: 'Get media asset details (scoped by owner)' })
  async getOne(@Param('mediaId') mediaId: string, @Req() req: Request) {
    const u = req.user as UsuarioAutenticado | undefined;
    const data = await this.mediaIngestion.getById(
      mediaId,
      ownerFilterFor({ userId: u?.userId, role: u?.role })
    );
    return { success: true, data };
  }

  @Delete(':mediaId')
  @Roles('fleet_admin', 'super_admin', 'advertiser')
  @ApiOperation({ summary: 'Soft-delete a media asset (scoped by owner)' })
  async remove(@Param('mediaId') mediaId: string, @Req() req: Request) {
    const u = req.user as UsuarioAutenticado | undefined;
    await this.mediaIngestion.softDelete(
      mediaId,
      ownerFilterFor({ userId: u?.userId, role: u?.role })
    );
    return { success: true };
  }
}
