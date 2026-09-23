import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ThumbnailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async process(input: {
    fileVersionId: string;
    storageKey: string;
    mimeType: string;
    workspaceId: string;
  }) {
    await this.prisma.fileVersion.update({
      where: { id: input.fileVersionId },
      data: { thumbnailStatus: 'processing' },
    });

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(input.mimeType)) {
      await this.prisma.fileVersion.update({
        where: { id: input.fileVersionId },
        data: { thumbnailStatus: 'none' },
      });
      return { status: 'none' as const };
    }

    const object = await this.storageService.getObjectForProcessing(input.storageKey);
    const thumbnailKey = `thumbnails/${input.workspaceId}/${input.fileVersionId}.webp`;
    const output = await sharp(object)
      .resize(512, 512, { fit: 'inside' })
      .webp({ quality: 78 })
      .toBuffer();

    await this.storageService.putProcessedObject(thumbnailKey, output, 'image/webp');
    await this.prisma.fileVersion.update({
      where: { id: input.fileVersionId },
      data: { thumbnailKey, thumbnailStatus: 'done' },
    });

    return { status: 'done' as const, thumbnailKey };
  }
}
