import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { InboxItemType, Prisma } from '@prisma/client';

export type UpsertInboxItemInput = {
  organizationId: string;
  integrationId: string;
  type: InboxItemType;
  remoteId: string;
  threadKey?: string | null;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  replyCapable: boolean;
  remoteUrl?: string | null;
  remoteCreatedAt?: Date | null;
};

@Injectable()
export class InboxRepository {
  constructor(private _inboxItem: PrismaRepository<'inboxItem'>) {}

  upsertItem(input: UpsertInboxItemInput) {
    const {
      organizationId,
      integrationId,
      type,
      remoteId,
      threadKey,
      authorName,
      authorId,
      authorPicture,
      body,
      replyCapable,
      remoteUrl,
      remoteCreatedAt,
    } = input;

    return this._inboxItem.model.inboxItem.upsert({
      where: {
        integrationId_type_remoteId: {
          integrationId,
          type,
          remoteId,
        },
      },
      create: {
        organizationId,
        integrationId,
        type,
        remoteId,
        threadKey: threadKey || null,
        authorName: authorName || null,
        authorId: authorId || null,
        authorPicture: authorPicture || null,
        body,
        replyCapable,
        remoteUrl: remoteUrl || null,
        remoteCreatedAt: remoteCreatedAt || null,
      },
      update: {
        // Never move org/integration ownership on upsert
        threadKey: threadKey || null,
        authorName: authorName || null,
        authorId: authorId || null,
        authorPicture: authorPicture || null,
        body,
        replyCapable,
        remoteUrl: remoteUrl || null,
        remoteCreatedAt: remoteCreatedAt || null,
        deletedAt: null,
      },
    });
  }

  getById(orgId: string, id: string) {
    return this._inboxItem.model.inboxItem.findFirst({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            providerIdentifier: true,
            refreshNeeded: true,
            disabled: true,
          },
        },
      },
    });
  }

  list(
    orgId: string,
    query: {
      page?: number;
      limit?: number;
      type?: InboxItemType;
      integrationId?: string;
      unreadOnly?: boolean;
    }
  ) {
    const page = Math.max(0, query.page || 0);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const where: Prisma.InboxItemWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    return Promise.all([
      this._inboxItem.model.inboxItem.findMany({
        where,
        orderBy: [{ remoteCreatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: page * limit,
        take: limit,
        include: {
          integration: {
            select: {
              id: true,
              name: true,
              picture: true,
              providerIdentifier: true,
              refreshNeeded: true,
              disabled: true,
            },
          },
        },
      }),
      this._inboxItem.model.inboxItem.count({ where }),
    ]).then(([items, total]) => ({
      items,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total,
    }));
  }

  markRead(orgId: string, id: string) {
    return this._inboxItem.model.inboxItem.updateMany({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });
  }

  softDelete(orgId: string, id: string) {
    return this._inboxItem.model.inboxItem.updateMany({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  deleteByIntegration(orgId: string, integrationId: string) {
    return this._inboxItem.model.inboxItem.updateMany({
      where: {
        organizationId: orgId,
        integrationId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }
}
