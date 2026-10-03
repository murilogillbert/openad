import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { FolderNode, FolderNodeDocument } from './schemas/folder-node.schema';

function slugSegment(name: string): string {
  const s = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s.length > 0 ? s.slice(0, 120) : 'campaign';
}

/**
 * Campaign lifecycle hook: materialize `/Root/Campaigns/{slug}` (T039).
 */
@Injectable()
export class MediaFolderProvisioningService {
  constructor(
    @InjectModel(FolderNode.name)
    private readonly folderModel: Model<FolderNodeDocument>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(MediaFolderProvisioningService.name);
  }

  async ensureCampaignFolder(
    campaignId: string,
    campaignName: string
  ): Promise<void> {
    await this.ensureCampaignFolderId(campaignId, campaignName);
  }

  /**
   * Mesma garantia de `ensureCampaignFolder`, mas devolve o identificador da pasta.
   *
   * Existe porque o upload do anunciante precisa colocar o criativo **na pasta da campanha**,
   * e nao na `/Root/Defaults/Global_Ads` que o fluxo de VFS usa como destino padrao. Deixar o
   * cliente informar o `folderId` nao serve: ele poderia apontar para a pasta de outro
   * anunciante. Entao o servidor resolve a pasta a partir da campanha, que ele ja validou ser
   * do solicitante.
   *
   * Devolve `null` quando o VFS nao foi inicializado — mesmo caso em que a versao anterior
   * apenas registrava aviso e seguia. Quem chama decide se isso e fatal; para o upload do
   * anunciante e, porque o criativo iria para a pasta errada.
   */
  async ensureCampaignFolderId(
    campaignId: string,
    campaignName: string
  ): Promise<string | null> {
    const campaignsRoot = await this.folderModel
      .findOne({ materializedPath: '/Root/Campaigns' })
      .exec();
    if (!campaignsRoot) {
      void this.logger.warn(
        { campaignId },
        'Campaigns root missing; skip media folder provisioning'
      );
      return null;
    }
    const seg = slugSegment(campaignName);
    const materializedPath = `/Root/Campaigns/${seg}`;
    const existing = await this.folderModel
      .findOne({ materializedPath })
      .exec();
    if (existing) {
      if (existing.campaignId !== campaignId) {
        await this.folderModel
          .updateOne({ _id: existing._id }, { $set: { campaignId } })
          .exec();
      }
      return existing._id.toString();
    }
    const criada = await this.folderModel.create({
      name: seg,
      parentId: campaignsRoot._id.toString(),
      materializedPath,
      campaignId,
      isSystemLocked: false,
    });
    void this.logger.info(
      { campaignId, materializedPath },
      'campaign media folder provisioned'
    );
    return criada._id.toString();
  }
}
