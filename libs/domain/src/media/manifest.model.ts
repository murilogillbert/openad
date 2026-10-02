export interface ManifestItemModel {
  mediaId: string;
  priority: number;
  hash: string;
  downloadUrl: string;
  fileSize: number;
  durationSeconds: number;
  campaignId?: string;
}

export interface ManifestModel {
  manifestId: string;
  deviceId: string;
  version: number;
  generatedAt: string;
  items: ManifestItemModel[];
}
