import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InboxRepository,
  UpsertInboxItemInput,
} from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';
import { InboxItemType, Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

@Injectable()
export class InboxService {
  constructor(
    private _inboxRepository: InboxRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  // Access tokens naturally expire between the daily refresh cron runs; a
  // 401 (RefreshToken) is expected here and should be healed with the
  // stored refresh token before we give up on the channel, the same way
  // IntegrationService.checkAnalytics already does for the Analytics tab.
  private async withTokenRefresh<T>(
    integration: Integration,
    action: (integration: Integration) => Promise<T>,
    reconnectMessage: string
  ): Promise<T> {
    try {
      return await action(integration);
    } catch (err) {
      if (!(err instanceof RefreshToken)) {
        throw err;
      }

      const refreshed = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refreshed || !refreshed.accessToken) {
        throw new BadRequestException(reconnectMessage);
      }

      try {
        return await action({ ...integration, token: refreshed.accessToken });
      } catch {
        throw new BadRequestException(reconnectMessage);
      }
    }
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
    return this._inboxRepository.list(orgId, query);
  }

  async getById(orgId: string, id: string) {
    const item = await this._inboxRepository.getById(orgId, id);
    if (!item) {
      throw new NotFoundException('Inbox item not found');
    }
    return item;
  }

  async markRead(orgId: string, id: string) {
    await this.getById(orgId, id);
    await this._inboxRepository.markRead(orgId, id);
    return this.getById(orgId, id);
  }

  async deleteItem(orgId: string, id: string) {
    await this.getById(orgId, id);
    await this._inboxRepository.softDelete(orgId, id);
    return { id, deleted: true };
  }

  upsertItems(items: UpsertInboxItemInput[]) {
    return Promise.all(items.map((item) => this._inboxRepository.upsertItem(item)));
  }

  async getSyncStatus(orgId: string) {
    const raw = await ioRedis.get(`inbox:sync:${orgId}`);
    if (!raw) {
      return { status: 'idle' as const, error: null, syncedAt: null };
    }
    try {
      return JSON.parse(raw) as {
        status: 'ok' | 'error' | 'idle';
        error: string | null;
        syncedAt: string | null;
      };
    } catch {
      return { status: 'idle' as const, error: null, syncedAt: null };
    }
  }

  async setSyncStatus(
    orgId: string,
    status: 'ok' | 'error' | 'idle',
    error?: string | null
  ) {
    await ioRedis.set(
      `inbox:sync:${orgId}`,
      JSON.stringify({
        status,
        error: error || null,
        syncedAt: new Date().toISOString(),
      }),
      'EX',
      7 * 24 * 60 * 60
    );
  }

  capabilitiesForProvider(providerIdentifier: string) {
    const provider =
      this._integrationManager.getSocialIntegration(providerIdentifier);
    const caps = provider?.inboxCapabilities?.() || {
      comments: false,
      mentions: false,
      dms: false,
      embeddable: false,
    };
    return {
      providerIdentifier,
      ...caps,
      supported: !!(caps.comments || caps.mentions || caps.dms),
    };
  }

  async listChannelCapabilities(orgId: string) {
    const integrations = await this._integrationService.getIntegrationsList(
      orgId
    );
    return integrations
      .filter((i) => !i.disabled && !i.deletedAt)
      .map((i) => ({
        integrationId: i.id,
        name: i.name,
        providerIdentifier: i.providerIdentifier,
        refreshNeeded: i.refreshNeeded,
        ...this.capabilitiesForProvider(i.providerIdentifier),
      }));
  }

  async syncOrganization(orgId: string) {
    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((i) => !i.disabled && !i.deletedAt);

    let upserted = 0;
    const errors: string[] = [];

    for (const integration of integrations) {
      try {
        upserted += await this.withTokenRefresh(
          integration,
          (i) => this.syncIntegration(i),
          'reconnect required'
        );
      } catch (err) {
        errors.push(
          `${integration.name}: ${
            err instanceof Error ? err.message : 'sync failed'
          }`
        );
      }
    }

    if (errors.length) {
      await this.setSyncStatus(orgId, 'error', errors.join('; '));
    } else {
      await this.setSyncStatus(orgId, 'ok');
    }

    return { upserted, errors };
  }

  async syncIntegration(integration: Integration) {
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.fetchInboxItems) {
      return 0;
    }

    const remoteItems = await provider.fetchInboxItems(
      integration.token,
      integration
    );

    const mapped: UpsertInboxItemInput[] = (remoteItems || []).map((item) => ({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      type: item.type,
      remoteId: item.remoteId,
      threadKey: item.threadKey,
      authorName: item.authorName,
      authorId: item.authorId,
      authorPicture: item.authorPicture,
      body: item.body,
      replyCapable: !!item.replyCapable,
      remoteUrl: item.remoteUrl,
      remoteCreatedAt: item.remoteCreatedAt
        ? new Date(item.remoteCreatedAt)
        : null,
    }));

    if (!mapped.length) {
      return 0;
    }

    await this.upsertItems(mapped);
    return mapped.length;
  }

  async reply(orgId: string, id: string, message: string) {
    const trimmed = (message || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Reply message is required');
    }

    const item = await this.getById(orgId, id);
    if (!item.replyCapable) {
      throw new BadRequestException('This inbox item cannot be replied to');
    }

    if (item.integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before replying to inbox items'
      );
    }

    const fullIntegration = await this._integrationService.getIntegrationById(
      orgId,
      item.integrationId
    );
    if (!fullIntegration) {
      throw new NotFoundException('Channel not found');
    }

    const provider = this._integrationManager.getSocialIntegration(
      fullIntegration.providerIdentifier
    );
    if (!provider?.replyToInboxItem) {
      throw new BadRequestException(
        'This channel does not support inbox replies'
      );
    }

    const result = await this.withTokenRefresh(
      fullIntegration,
      (i) =>
        provider.replyToInboxItem(
          i.token,
          {
            type: item.type,
            remoteId: item.remoteId,
            threadKey: item.threadKey,
            authorId: item.authorId,
          },
          trimmed,
          i
        ),
      'Reconnect the channel before replying to inbox items'
    );

    await this._inboxRepository.markRead(orgId, id);
    return { id, replyRemoteId: result?.remoteId || null };
  }

  async getThread(orgId: string, integrationId: string, postRemoteId: string) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before viewing inbox threads'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().threads) {
      throw new BadRequestException(
        'This channel does not support inbox comments'
      );
    }

    return this.withTokenRefresh(
      integration,
      (i) => provider.fetchInboxThread(i.token, postRemoteId, i),
      'Reconnect the channel before viewing inbox threads'
    );
  }

  async likeComment(
    orgId: string,
    integrationId: string,
    commentRemoteId: string,
    liked: boolean
  ) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before liking inbox comments'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().likes) {
      throw new BadRequestException(
        'This channel does not support liking inbox comments'
      );
    }

    return this.withTokenRefresh(
      integration,
      (i) => provider.likeInboxComment(i.token, commentRemoteId, liked, i),
      'Reconnect the channel before liking inbox comments'
    );
  }

  async replyToComment(
    orgId: string,
    integrationId: string,
    commentRemoteId: string,
    message: string
  ) {
    const trimmed = (message || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Reply message is required');
    }

    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before replying to inbox items'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().comments) {
      throw new BadRequestException(
        'This channel does not support inbox replies'
      );
    }

    const result = await this.withTokenRefresh(
      integration,
      (i) =>
        provider.replyToInboxItem(
          i.token,
          { type: 'COMMENT', remoteId: commentRemoteId },
          trimmed,
          i
        ),
      'Reconnect the channel before replying to inbox items'
    );
    return { replyRemoteId: result?.remoteId || null };
  }
}
