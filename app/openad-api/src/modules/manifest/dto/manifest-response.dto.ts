import type { Operation } from 'fast-json-patch';
import type { SpatialEntryContract } from '@openad/api-contracts';

/** Wire shape for POST /manifest success body.data (004 contracts). */
export interface ManifestMediaItemDto {
  mediaId: string;
  hash: string;
  priority: number;
  downloadUrl: string;
  fileSize: number;
  duration: number;
  /**
   * Tipo do conteudo, para o player escolher entre `<img>` e `<video>`.
   *
   * Sem este campo o tablete tratava todo item como video e punha o arquivo num `<video>`.
   * Como a frota inteira de criativos e JPEG/PNG, nenhum deles decodificava e a tela ficava
   * num retangulo preto. Vem sempre preenchido: quando o documento nao tem `mimeType`
   * (upload antigo), e deduzido da extensao do `filename`.
   */
  mimeType: string;
  /** Denormalized from media placement; campaign-level targeting is separate from media bytes. */
  campaignId?: string;
}

export interface ManifestSpatialSectionDto {
  version: string;
  entries: SpatialEntryContract[];
}

export interface ManifestFullDataDto {
  deviceId: string;
  version: string;
  isDelta: false;
  media: ManifestMediaItemDto[];
  spatial: ManifestSpatialSectionDto;
}

export interface ManifestDeltaDataDto {
  deviceId: string;
  version: string;
  previousVersion: string;
  isDelta: true;
  operations: Operation[];
}

export type ManifestResponseDataDto = ManifestFullDataDto | ManifestDeltaDataDto;
