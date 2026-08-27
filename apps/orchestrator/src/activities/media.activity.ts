import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import dayjs from 'dayjs';

@Injectable()
@Activity()
export class MediaActivity {
  constructor(
    private _mediaService: MediaService,
    private _mediaRepository: MediaRepository
  ) {}

  @ActivityMethod()
  async purgeExpiredMediaTrash() {
    const before = dayjs().subtract(30, 'day').toDate();
    const media = await this._mediaRepository.getTrashedMediaOlderThan(before);

    for (const item of media) {
      await this._mediaService.purgeMedia(item.organizationId, item.id);
    }

    const folders =
      await this._mediaRepository.getTrashedFoldersOlderThan(before);

    for (const folder of folders) {
      await this._mediaRepository.hardDeleteFolder(
        folder.organizationId,
        folder.id
      );
    }

    return {
      mediaPurged: media.length,
      foldersPurged: folders.length,
    };
  }
}
