export type MediaCategorization = 'universal' | 'conditional';

export type VideoCodec = 'h264' | 'h265';

export interface MediaAssetModel {
  mediaId: string;
  hash: string;
  filename: string;
  fileSize: number;
  bitrate: number;
  width: number;
  height: number;
  codec: VideoCodec;
  duration: number;
  categorization: MediaCategorization;
  storageUrl: string;
  uploadedBy?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
