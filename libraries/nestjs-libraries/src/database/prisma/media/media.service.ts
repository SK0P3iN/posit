import { HttpException, Injectable } from '@nestjs/common';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { generationError } from '@gitroom/nestjs-libraries/openai/generation.error';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CreateMediaFolderDto } from '@gitroom/nestjs-libraries/dtos/media/create.media.folder.dto';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _mediaRepository: MediaRepository,
    private _postsRepository: PostsRepository,
    private _openAi: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _videoManager: VideoManager
  ) {}

  async deleteMedia(org: string, id: string) {
    return this.bulkDeleteMedia(org, [id], false);
  }

  async purgeMedia(org: string, id: string) {
    const media = await this._mediaRepository.getMediaById(id);
    if (!media || media.organizationId !== org) {
      return null;
    }

    await this.removeMediaFromStorage(media.path, media.thumbnail);

    return this._mediaRepository.hardDeleteMedia(org, id);
  }

  private async removeMediaFromStorage(
    path: string,
    thumbnail?: string | null
  ) {
    if (path) {
      try {
        await this.storage.removeFile(path);
      } catch (err) {
        console.error('Failed to remove media file from storage:', err);
      }
    }

    if (thumbnail) {
      try {
        await this.storage.removeFile(thumbnail);
      } catch (err) {
        console.error('Failed to remove media thumbnail from storage:', err);
      }
    }
  }

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
  }

  getFolders(org: string) {
    return this._mediaRepository.getFolders(org);
  }

  getTrashedFolders(org: string) {
    return this._mediaRepository.getFolders(org, true);
  }

  async createFolder(org: string, body: CreateMediaFolderDto) {
    const folder = await this._mediaRepository.createFolder(org, body);
    if (!folder) {
      throw new HttpException('Parent folder not found', 404);
    }
    return folder;
  }

  async renameFolder(org: string, id: string, name: string) {
    const folder = await this._mediaRepository.renameFolder(org, id, name);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }
    return folder;
  }

  async moveMedia(org: string, ids: string[], folderId: string | null) {
    if (folderId) {
      const folder = await this._mediaRepository.getFolderById(org, folderId);
      if (!folder) {
        throw new HttpException('Folder not found', 404);
      }
    }

    return this._mediaRepository.moveMedia(org, ids, folderId);
  }

  async getMediaUsage(org: string, ids: string[]) {
    const media = await this._mediaRepository.getMediaByIds(org, ids);
    const foundIds = media.map((item) => item.id);
    const posts =
      await this._postsRepository.findEditablePostsPossiblyReferencingMedia(
        org,
        foundIds
      );

    const idSet = new Set(foundIds);
    const consumers: Array<{
      mediaId: string;
      type: 'post' | 'user' | 'oauth' | 'agency';
      id: string;
      label: string;
      state?: string;
    }> = [];

    for (const post of posts) {
      const referenced = this.extractReferencedMediaIds(
        post.image,
        post.settings
      ).filter((id) => idSet.has(id));

      for (const mediaId of referenced) {
        consumers.push({
          mediaId,
          type: 'post',
          id: post.id,
          label: post.title || post.content?.slice(0, 80) || post.publishDate.toISOString(),
          state: post.state,
        });
      }
    }

    for (const item of media) {
      for (const user of item.userPicture) {
        consumers.push({
          mediaId: item.id,
          type: 'user',
          id: user.id,
          label: user.name || user.email,
        });
      }
      for (const app of item.oauthApps) {
        consumers.push({
          mediaId: item.id,
          type: 'oauth',
          id: app.id,
          label: app.name,
        });
      }
      for (const agency of item.agencies) {
        consumers.push({
          mediaId: item.id,
          type: 'agency',
          id: agency.id,
          label: agency.name,
        });
      }
    }

    return {
      inUse: consumers.length > 0,
      count: consumers.length,
      consumers,
      foundIds,
    };
  }

  extractMediaIdsFromValues(image: unknown, settings: unknown) {
    const ids = new Set<string>();
    this.collectMediaDtoIds(image, ids);
    this.collectMediaDtoIds(settings, ids);
    return [...ids];
  }

  private extractReferencedMediaIds(
    image: string | null,
    settings: string | null
  ) {
    let parsedImage: unknown = null;
    let parsedSettings: unknown = null;

    if (image) {
      try {
        parsedImage = JSON.parse(image);
      } catch {
        // ignore invalid image json
      }
    }

    if (settings) {
      try {
        parsedSettings = JSON.parse(settings);
      } catch {
        // ignore invalid settings json
      }
    }

    return this.extractMediaIdsFromValues(parsedImage, parsedSettings);
  }

  private collectMediaDtoIds(value: unknown, ids: Set<string>) {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectMediaDtoIds(item, ids);
      }
      return;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (
        typeof record.id === 'string' &&
        typeof record.path === 'string'
      ) {
        ids.add(record.id);
      }
      for (const child of Object.values(record)) {
        this.collectMediaDtoIds(child, ids);
      }
    }
  }

  async bulkDeleteMedia(org: string, ids: string[], confirm = false) {
    const usage = await this.getMediaUsage(org, ids);
    if (usage.inUse && !confirm) {
      return {
        requiresConfirm: true,
        ...usage,
      };
    }

    if (confirm || usage.inUse) {
      await this._postsRepository.stripMediaFromPosts(org, ids);
    }

    await this._mediaRepository.softDeleteMediaMany(org, ids);

    for (const id of usage.foundIds) {
      try {
        await this._mediaRepository.recordUsageHistory(org, id, 'deleted');
      } catch {
        // history is best-effort
      }
    }

    return {
      requiresConfirm: false,
      deleted: ids,
      ...usage,
    };
  }

  async deleteFolder(org: string, id: string, confirm = false) {
    const folder = await this._mediaRepository.getFolderById(org, id);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }

    const folderIds = await this._mediaRepository.getDescendantFolderIds(
      org,
      id
    );
    const media = await this._mediaRepository.getMediaIdsInFolders(
      org,
      folderIds
    );
    const mediaIds = media.map((item) => item.id);

    if (mediaIds.length) {
      const usage = await this.getMediaUsage(org, mediaIds);
      if (usage.inUse && !confirm) {
        return {
          requiresConfirm: true,
          folderIds,
          mediaIds,
          ...usage,
        };
      }

      if (confirm || usage.inUse) {
        await this._postsRepository.stripMediaFromPosts(org, mediaIds);
      }

      await this._mediaRepository.softDeleteMediaMany(org, mediaIds);

      for (const mediaId of mediaIds) {
        try {
          await this._mediaRepository.recordUsageHistory(
            org,
            mediaId,
            'deleted'
          );
        } catch {
          // history is best-effort
        }
      }
    }

    await this._mediaRepository.softDeleteFolders(org, folderIds);

    return {
      requiresConfirm: false,
      folderIds,
      mediaIds,
    };
  }

  getTrash(org: string, page: number) {
    return this._mediaRepository.getTrash(org, page);
  }

  async restore(
    org: string,
    mediaIds?: string[],
    folderIds?: string[]
  ) {
    const restoredFolders = folderIds?.length
      ? await this._mediaRepository.restoreFolders(org, folderIds)
      : [];
    const restoredMedia = mediaIds?.length
      ? await this._mediaRepository.restoreMedia(org, mediaIds)
      : [];

    return {
      folders: restoredFolders,
      media: restoredMedia,
    };
  }

  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean
  ) {
    try {
      const generating = await this._subscriptionService.useCredit(
        org,
        'ai_images',
        async () => {
          if (generatePromptFirst) {
            prompt = await this._openAi.generatePromptForPicture(prompt);
            console.log('Prompt:', prompt);
          }
          return this._openAi.generateImage(prompt);
        }
      );

      return generating;
    } catch (err) {
      throw generationError(err);
    }
  }

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    folderId?: string | null,
    fileSize?: number
  ) {
    return this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      folderId,
      fileSize
    );
  }

  async getMedia(
    org: string,
    page: number,
    search?: string,
    folderId?: string | null,
    unfiled?: boolean,
    usage?: 'unused' | 'detached'
  ) {
    let excludeIds: string[] | undefined;
    let includeIds: string[] | undefined;

    if (usage === 'unused' || usage === 'detached') {
      const attachedIds = await this.getCurrentlyAttachedMediaIds(org);
      if (usage === 'unused') {
        excludeIds = attachedIds;
      } else {
        const history = await this._mediaRepository.getHistoryMediaIds(org);
        includeIds = history
          .map((item) => item.mediaId)
          .filter((id) => !attachedIds.includes(id));
      }
    }

    return this._mediaRepository.getMedia(
      org,
      page,
      search,
      folderId,
      unfiled,
      excludeIds,
      includeIds
    );
  }

  async getCurrentlyAttachedMediaIds(org: string) {
    const fk = await this._mediaRepository.getFkAttachedMediaIds(org);
    const editablePosts =
      await this._postsRepository.findAllEditablePostsWithMedia(org);

    const ids = new Set(fk.map((item) => item.id));
    for (const post of editablePosts) {
      for (const id of this.extractReferencedMediaIds(
        post.image,
        post.settings
      )) {
        ids.add(id);
      }
    }

    return [...ids];
  }

  async recordAttachedMedia(
    org: string,
    mediaIds: string[],
    postId?: string
  ) {
    for (const mediaId of [...new Set(mediaIds)]) {
      try {
        await this._mediaRepository.recordUsageHistory(
          org,
          mediaId,
          'attached',
          postId
        );
      } catch {
        // best-effort
      }
    }
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      throw new Error(`Video type ${type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  async generateVideo(org: Organization, body: VideoDto) {
    try {
      const totalCredits = await this._subscriptionService.checkCredits(
        org,
        'ai_videos'
      );

      if (totalCredits.credits <= 0) {
        throw new SubscriptionException({
          action: AuthorizationActions.Create,
          section: Sections.VIDEOS_PER_MONTH,
        });
      }

      const video = this._videoManager.getVideoByName(body.type);
      if (!video) {
        throw new Error(`Video type ${body.type} not found`);
      }

      if (!video.trial && org.isTrailing) {
        throw new HttpException(
          'This video is not available in trial mode',
          406
        );
      }

      console.log(body.customParams);
      await video.instance.processAndValidate(body.customParams);
      console.log('no err');

      return await this._subscriptionService.useCredit(
        org,
        'ai_videos',
        async () => {
          const loadedData = await video.instance.process(
            body.output,
            body.customParams
          );

          const file = await this.storage.uploadSimple(loadedData);
          return this.saveFile(org.id, file.split('/').pop(), file);
        }
      );
    } catch (err) {
      throw generationError(err);
    }
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new Error(`Video with identifier ${identifier} not found`);
    }

    // @ts-ignore
    const functionToCall = video.instance[functionName];
    if (
      typeof functionToCall !== 'function' ||
      this._videoManager.checkAvailableVideoFunction(functionToCall)
    ) {
      throw new HttpException(
        `Function ${functionName} not found on video instance`,
        400
      );
    }

    return functionToCall(body);
  }
}
