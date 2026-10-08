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

  /**
   * Cota dura de exibicoes deste item **no ciclo atual**, e quando ela expira.
   *
   * **Sem a cota, a reserva de credito nao limita nada.** O tablet recebe o manifesto e toca
   * em laco: e ele que decide quantas vezes exibe. A reserva garante que so se captura o que
   * foi reservado, mas sem a cota o aparelho exibe alem dela — e a exibicao excedente nao
   * fatura, entao o anunciante recebe entrega que nao pagou e o motorista nao e creditado por
   * ela. A cota e o pacing com teto duro.
   *
   * Os dois campos sao **opcionais e aditivos**: APK antigo os ignora e segue tocando em laco,
   * como antes. A captura continua limitada ao que foi reservado, entao o excedente nao vira
   * cobranca — o que se perde e so a precisao da entrega, ate a frota ser atualizada (o APK do
   * tablete e instalado por cabo, sem loja).
   *
   * Ausentes em inventario institucional, que toca sem faturar e sem limite de credito.
   */
  maxPlaysInCycle?: number;
  cycleEndsAt?: string;
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
