import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { CreateMediaFolderDto } from '@gitroom/nestjs-libraries/dtos/media/create.media.folder.dto';

@Injectable()
export class MediaRepository {
  constructor(
    private _media: PrismaRepository<'media'>,
    private _mediaFolder: PrismaRepository<'mediaFolder'>,
    private _mediaUsageHistory: PrismaRepository<'mediaUsageHistory'>
  ) {}

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    folderId?: string | null,
    fileSize?: number
  ) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
        fileSize: fileSize || 0,
        ...(folderId
          ? {
              folder: {
                connect: {
                  id: folderId,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        folderId: true,
        fileSize: true,
      },
    });
  }

  getFolders(org: string, trashed = false) {
    return this._mediaFolder.model.mediaFolder.findMany({
      where: {
        organizationId: org,
        deletedAt: trashed ? { not: null } : null,
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        parentId: true,
        order: true,
        createdAt: true,
        deletedAt: true,
      },
    });
  }

  async reorderFolders(org: string, orders: { id: string; order: number }[]) {
    const ids = orders.map((item) => item.id);
    const existing = await this._mediaFolder.model.mediaFolder.findMany({
      where: {
        organizationId: org,
        id: { in: ids },
        deletedAt: null,
      },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((folder) => folder.id));

    await Promise.all(
      orders
        .filter((item) => existingIds.has(item.id))
        .map((item) =>
          this._mediaFolder.model.mediaFolder.update({
            where: { id: item.id },
            data: { order: item.order },
          })
        )
    );

    return { updated: [...existingIds] };
  }

  async createFolder(org: string, body: CreateMediaFolderDto) {
    if (body.parentId) {
      const parent = await this._mediaFolder.model.mediaFolder.findFirst({
        where: {
          id: body.parentId,
          organizationId: org,
          deletedAt: null,
        },
      });
      if (!parent) {
        return null;
      }
    }

    return this._mediaFolder.model.mediaFolder.create({
      data: {
        organizationId: org,
        name: body.name,
        parentId: body.parentId || null,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
      },
    });
  }

  async renameFolder(org: string, id: string, name: string) {
    const folder = await this.getFolderById(org, id);
    if (!folder) {
      return null;
    }

    return this._mediaFolder.model.mediaFolder.update({
      where: { id },
      data: { name },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
      },
    });
  }

  getFolderById(org: string, id: string, includeDeleted = false) {
    return this._mediaFolder.model.mediaFolder.findFirst({
      where: {
        id,
        organizationId: org,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
    });
  }

  async getDescendantFolderIds(
    org: string,
    rootId: string,
    includeDeleted = false
  ) {
    const folders = await this._mediaFolder.model.mediaFolder.findMany({
      where: {
        organizationId: org,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      select: {
        id: true,
        parentId: true,
      },
    });

    const childrenMap = new Map<string, string[]>();
    for (const folder of folders) {
      if (!folder.parentId) {
        continue;
      }
      const list = childrenMap.get(folder.parentId) || [];
      list.push(folder.id);
      childrenMap.set(folder.parentId, list);
    }

    const collected = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const child of childrenMap.get(current) || []) {
        if (!collected.has(child)) {
          collected.add(child);
          queue.push(child);
        }
      }
    }

    return [...collected];
  }

  getMediaIdsInFolders(org: string, folderIds: string[]) {
    return this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        folderId: { in: folderIds },
      },
      select: { id: true },
    });
  }

  getTrashedMediaIdsInFolders(org: string, folderIds: string[]) {
    return this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: { not: null },
        folderId: { in: folderIds },
      },
      select: { id: true },
    });
  }

  hardDeleteFolderRow(org: string, id: string) {
    return this._mediaFolder.model.mediaFolder.delete({
      where: {
        id,
        organizationId: org,
      },
    });
  }

  softDeleteFolders(org: string, folderIds: string[]) {
    return this._mediaFolder.model.mediaFolder.updateMany({
      where: {
        organizationId: org,
        id: { in: folderIds },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  softDeleteMediaMany(org: string, ids: string[]) {
    return this._media.model.media.updateMany({
      where: {
        organizationId: org,
        id: { in: ids },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  moveMedia(org: string, ids: string[], folderId: string | null) {
    return this._media.model.media.updateMany({
      where: {
        organizationId: org,
        id: { in: ids },
        deletedAt: null,
      },
      data: {
        folderId,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  getMediaByIds(org: string, ids: string[]) {
    return this._media.model.media.findMany({
      where: {
        organizationId: org,
        id: { in: ids },
      },
      include: {
        userPicture: {
          select: { id: true, name: true, email: true },
        },
        oauthApps: {
          select: { id: true, name: true },
        },
        agencies: {
          select: { id: true, name: true },
        },
      },
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  hardDeleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        userPicture: { set: [] },
        oauthApps: { set: [] },
        agencies: { set: [] },
      },
    }).then(() =>
      this._media.model.media.delete({
        where: {
          id,
          organizationId: org,
        },
      })
    );
  }

  getTrashedMediaOlderThan(before: Date) {
    return this._media.model.media.findMany({
      where: {
        deletedAt: {
          not: null,
          lt: before,
        },
      },
      select: {
        id: true,
        organizationId: true,
        path: true,
        thumbnail: true,
      },
    });
  }

  getTrashedFoldersOlderThan(before: Date) {
    return this._mediaFolder.model.mediaFolder.findMany({
      where: {
        deletedAt: {
          not: null,
          lt: before,
        },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  hardDeleteFolder(org: string, id: string) {
    return this._media.model.media
      .updateMany({
        where: {
          organizationId: org,
          folderId: id,
        },
        data: {
          folderId: null,
        },
      })
      .then(() =>
        this._mediaFolder.model.mediaFolder.delete({
          where: {
            id,
            organizationId: org,
          },
        })
      );
  }

  async getTrash(org: string, page: number) {
    const pageNum = (page || 1) - 1;
    const where = {
      organizationId: org,
      deletedAt: { not: null as Date | null },
    };

    const pages = Math.ceil(
      (await this._media.model.media.count({ where })) / 18
    );
    const results = await this._media.model.media.findMany({
      where,
      orderBy: {
        deletedAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        folderId: true,
        deletedAt: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return { pages, results };
  }

  async restoreMedia(org: string, ids: string[]) {
    const media = await this._media.model.media.findMany({
      where: {
        organizationId: org,
        id: { in: ids },
        deletedAt: { not: null },
      },
      select: {
        id: true,
        folderId: true,
      },
    });

    for (const item of media) {
      let folderId = item.folderId;
      if (folderId) {
        const folder = await this._mediaFolder.model.mediaFolder.findFirst({
          where: {
            id: folderId,
            organizationId: org,
            deletedAt: null,
          },
        });
        if (!folder) {
          folderId = null;
        }
      }

      await this._media.model.media.update({
        where: { id: item.id },
        data: {
          deletedAt: null,
          folderId,
        },
      });
    }

    return media.map((item) => item.id);
  }

  async restoreFolders(org: string, folderIds: string[]) {
    const allFolders = await this._mediaFolder.model.mediaFolder.findMany({
      where: {
        organizationId: org,
      },
      select: {
        id: true,
        parentId: true,
        deletedAt: true,
      },
    });

    const byId = new Map(allFolders.map((f) => [f.id, f]));
    const childrenMap = new Map<string, string[]>();
    for (const folder of allFolders) {
      if (!folder.parentId) {
        continue;
      }
      const list = childrenMap.get(folder.parentId) || [];
      list.push(folder.id);
      childrenMap.set(folder.parentId, list);
    }

    const toRestore = new Set<string>();
    for (const rootId of folderIds) {
      const root = byId.get(rootId);
      if (!root || !root.deletedAt) {
        continue;
      }
      toRestore.add(rootId);
      const queue = [rootId];
      while (queue.length) {
        const current = queue.shift()!;
        for (const child of childrenMap.get(current) || []) {
          const childFolder = byId.get(child);
          if (childFolder?.deletedAt && !toRestore.has(child)) {
            toRestore.add(child);
            queue.push(child);
          }
        }
      }
    }

    for (const id of toRestore) {
      const folder = byId.get(id)!;
      let parentId = folder.parentId;
      if (parentId) {
        const parent = byId.get(parentId);
        if (!parent || (parent.deletedAt && !toRestore.has(parentId))) {
          parentId = null;
        }
      }

      await this._mediaFolder.model.mediaFolder.update({
        where: { id },
        data: {
          deletedAt: null,
          parentId,
        },
      });
    }

    const restoredFolderIds = [...toRestore];
    if (restoredFolderIds.length) {
      await this._media.model.media.updateMany({
        where: {
          organizationId: org,
          folderId: { in: restoredFolderIds },
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
        },
      });
    }

    return restoredFolderIds;
  }

  recordUsageHistory(
    org: string,
    mediaId: string,
    event: string,
    postId?: string | null
  ) {
    return this._mediaUsageHistory.model.mediaUsageHistory.create({
      data: {
        organizationId: org,
        mediaId,
        event,
        postId: postId || null,
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(
    org: string,
    page: number,
    search?: string,
    folderId?: string | null,
    unfiled?: boolean,
    excludeIds?: string[],
    includeIds?: string[]
  ) {
    const pageNum = (page || 1) - 1;
    const trimmedSearch = search?.trim();
    const searchFilter = trimmedSearch
      ? {
          originalName: {
            contains: trimmedSearch,
            mode: 'insensitive' as const,
          },
        }
      : {};

    const folderFilter =
      unfiled === true
        ? { folderId: null }
        : folderId
          ? { folderId }
          : {};

    const idFilter = includeIds
      ? { id: { in: includeIds.length ? includeIds : ['__none__'] } }
      : excludeIds?.length
        ? { id: { notIn: excludeIds } }
        : {};

    const where = {
      organizationId: org,
      deletedAt: null as Date | null,
      ...searchFilter,
      ...folderFilter,
      ...idFilter,
    };

    const pages = Math.ceil(
      (await this._media.model.media.count({ where })) / 18
    );
    const results = await this._media.model.media.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        folderId: true,
        fileSize: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }

  getFkAttachedMediaIds(org: string) {
    return this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        OR: [
          { userPicture: { some: {} } },
          { oauthApps: { some: {} } },
          { agencies: { some: {} } },
        ],
      },
      select: { id: true },
    });
  }

  getHistoryMediaIds(org: string) {
    return this._mediaUsageHistory.model.mediaUsageHistory.findMany({
      where: {
        organizationId: org,
        event: 'attached',
      },
      distinct: ['mediaId'],
      select: { mediaId: true },
    });
  }
}
