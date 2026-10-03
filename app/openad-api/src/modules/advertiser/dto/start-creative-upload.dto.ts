import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Corpo do primeiro passo do upload de criativo.
 *
 * Deliberadamente menor que `UploadSessionInitRequest`: `folderId`, `campaignId` e
 * `campaignIds` **nao** entram aqui. Eles sao resolvidos no servidor a partir da campanha
 * cujo dono ja foi verificado — aceitar do cliente permitiria depositar criativo na pasta de
 * outro anunciante.
 *
 * O `contentType` nao e validado contra uma lista aqui de proposito: a lista permitida vem de
 * `MEDIA_ALLOWED_MIME_TYPES` e e aplicada por `UploadSessionService.createSession`, que
 * devolve `UNSUPPORTED_MEDIA_TYPE`. Duplicar a lista num decorador criaria duas verdades que
 * divergem na primeira vez que alguem acrescentar um formato.
 */
export class StartCreativeUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  contentType!: string;
}
