// U2 (R1/R2/R3, KTD1): `embeddable` inbox capability flag threaded through
// InboxService's `capabilitiesForProvider()` / `listChannelCapabilities()`.
//
// Like posts.service.spec.ts, InboxService's constructor takes
// IntegrationManager and IntegrationService purely for their types — but
// under this package's emitDecoratorMetadata: true Jest config, an
// @Injectable() class's constructor param types are referenced at runtime
// for `design:paramtypes` reflection, which forces a real value import.
// Both modules pull in heavy transitive dependencies (IntegrationManager
// imports every social provider at module scope, including ESM-only ones
// like nostr-tools; IntegrationService pulls in TemporalService,
// UploadFactory, etc.) that this package's isolatedModules Jest config
// can't parse. Stub both modules out entirely; the tests below pass
// hand-rolled fakes for actual behavior.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({
    IntegrationService: class {},
  })
);

import { InboxService } from './inbox.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

function makeInboxService(overrides?: {
  integrationManager?: Partial<Record<string, jest.Mock>>;
  integrationService?: Partial<Record<string, jest.Mock>>;
  refreshIntegrationService?: Partial<Record<string, jest.Mock>>;
}) {
  const inboxRepository = {} as any;
  const integrationManager = {
    getSocialIntegration: jest.fn(),
    ...overrides?.integrationManager,
  };
  const integrationService = {
    getIntegrationsList: jest.fn(),
    ...overrides?.integrationService,
  };
  const refreshIntegrationService = {
    refresh: jest.fn(),
    ...overrides?.refreshIntegrationService,
  };

  const service = new InboxService(
    inboxRepository,
    integrationManager as any,
    integrationService as any,
    refreshIntegrationService as any
  );

  return {
    service,
    inboxRepository,
    integrationManager,
    integrationService,
    refreshIntegrationService,
  };
}

describe('InboxService - embeddable inbox capability (U2, R1/R2/R3)', () => {
  describe('capabilitiesForProvider', () => {
    it('returns embeddable: true for a provider whose inboxCapabilities() override sets it (instagram)', () => {
      const { service, integrationManager } = makeInboxService({
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
            }),
          }),
        },
      });

      const result = service.capabilitiesForProvider('instagram');

      expect(result).toEqual({
        providerIdentifier: 'instagram',
        comments: true,
        mentions: false,
        dms: false,
        embeddable: true,
        supported: true,
      });
      expect(integrationManager.getSocialIntegration).toHaveBeenCalledWith(
        'instagram'
      );
    });

    it('returns embeddable: false via the abstract default for a registered provider with no inboxCapabilities() override (e.g. tiktok)', () => {
      const { service } = makeInboxService({
        integrationManager: {
          // Provider is registered (getSocialIntegration finds a match), but
          // doesn't override inboxCapabilities() — so calling it returns
          // SocialAbstract's own default: { comments: false, mentions: false,
          // dms: false, embeddable: false }.
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: false,
              mentions: false,
              dms: false,
              embeddable: false,
            }),
          }),
        },
      });

      const result = service.capabilitiesForProvider('tiktok');

      expect(result).toEqual({
        providerIdentifier: 'tiktok',
        comments: false,
        mentions: false,
        dms: false,
        embeddable: false,
        supported: false,
      });
    });

    it('returns embeddable: false (not undefined) via the fallback literal when no provider is registered for the identifier', () => {
      const { service } = makeInboxService({
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue(undefined),
        },
      });

      const result = service.capabilitiesForProvider('some-unregistered-provider');

      expect(result).toEqual({
        providerIdentifier: 'some-unregistered-provider',
        comments: false,
        mentions: false,
        dms: false,
        embeddable: false,
        supported: false,
      });
      expect('embeddable' in result).toBe(true);
      expect(result.embeddable).toBe(false);
    });
  });

  describe('listChannelCapabilities', () => {
    it('returns embeddable: true for an instagram integration and false for a tiktok integration, unchanged shape otherwise', async () => {
      const integrations = [
        {
          id: 'ig-1',
          name: 'My Instagram',
          providerIdentifier: 'instagram',
          refreshNeeded: false,
          disabled: false,
          deletedAt: null,
        },
        {
          id: 'tt-1',
          name: 'My TikTok',
          providerIdentifier: 'tiktok',
          refreshNeeded: false,
          disabled: false,
          deletedAt: null,
        },
      ];

      const { service } = makeInboxService({
        integrationService: {
          getIntegrationsList: jest.fn().mockResolvedValue(integrations),
        },
        integrationManager: {
          getSocialIntegration: jest.fn((providerIdentifier: string) => {
            if (providerIdentifier === 'instagram') {
              return {
                inboxCapabilities: () => ({
                  comments: true,
                  mentions: false,
                  dms: false,
                  embeddable: true,
                }),
              };
            }
            if (providerIdentifier === 'tiktok') {
              return {
                inboxCapabilities: () => ({
                  comments: false,
                  mentions: false,
                  dms: false,
                  embeddable: false,
                }),
              };
            }
            return undefined;
          }),
        },
      });

      const result = await service.listChannelCapabilities('org-1');

      expect(result).toEqual([
        {
          integrationId: 'ig-1',
          name: 'My Instagram',
          providerIdentifier: 'instagram',
          refreshNeeded: false,
          comments: true,
          mentions: false,
          dms: false,
          embeddable: true,
          supported: true,
        },
        {
          integrationId: 'tt-1',
          name: 'My TikTok',
          providerIdentifier: 'tiktok',
          refreshNeeded: false,
          comments: false,
          mentions: false,
          dms: false,
          embeddable: false,
          supported: false,
        },
      ]);
    });
  });
});

describe('InboxService - comment thread, like, and remote-id reply', () => {
  describe('getThread', () => {
    it('throws NotFoundException when the integration does not belong to the org', async () => {
      const { service, integrationService } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        service.getThread('org-1', 'integration-1', 'post-1')
      ).rejects.toThrow('Channel not found');
    });

    it('throws BadRequestException when the provider does not support comments', async () => {
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'integration-1',
            token: 'token',
            refreshNeeded: false,
            disabled: false,
            providerIdentifier: 'youtube',
          }),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: false,
              mentions: false,
              dms: false,
              embeddable: false,
              likes: false,
            }),
          }),
        },
      });

      await expect(
        service.getThread('org-1', 'integration-1', 'post-1')
      ).rejects.toThrow('This channel does not support inbox comments');
    });

    it('throws BadRequestException for a provider that lists comments but not threads (youtube)', async () => {
      const fetchInboxThread = jest.fn();
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'integration-1',
            token: 'token',
            refreshNeeded: false,
            disabled: false,
            providerIdentifier: 'youtube',
          }),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: false,
              likes: false,
              threads: false,
            }),
            fetchInboxThread,
          }),
        },
      });

      await expect(
        service.getThread('org-1', 'integration-1', 'post-1')
      ).rejects.toThrow('This channel does not support inbox comments');
      expect(fetchInboxThread).not.toHaveBeenCalled();
    });

    it('delegates to provider.fetchInboxThread and returns its result', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const threadNodes = [{ remoteId: 'c1', replies: [] }];
      const fetchInboxThread = jest.fn().mockResolvedValue(threadNodes);
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
              threads: true,
            }),
            fetchInboxThread,
          }),
        },
      });

      const result = await service.getThread('org-1', 'integration-1', 'post-1');

      expect(result).toBe(threadNodes);
      expect(fetchInboxThread).toHaveBeenCalledWith('token', 'post-1', integration);
    });
  });

  describe('likeComment', () => {
    it('throws BadRequestException when the provider does not support likes', async () => {
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'integration-1',
            token: 'token',
            refreshNeeded: false,
            disabled: false,
            providerIdentifier: 'youtube',
          }),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: false,
            }),
          }),
        },
      });

      await expect(
        service.likeComment('org-1', 'integration-1', 'comment-1', true)
      ).rejects.toThrow('This channel does not support liking inbox comments');
    });

    it('delegates to provider.likeInboxComment and returns its result', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const likeInboxComment = jest
        .fn()
        .mockResolvedValue({ liked: true, likeCount: 4 });
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            likeInboxComment,
          }),
        },
      });

      const result = await service.likeComment(
        'org-1',
        'integration-1',
        'comment-1',
        true
      );

      expect(result).toEqual({ liked: true, likeCount: 4 });
      expect(likeInboxComment).toHaveBeenCalledWith(
        'token',
        'comment-1',
        true,
        integration
      );
    });
  });

  describe('replyToComment', () => {
    it('throws BadRequestException for a blank message', async () => {
      const { service } = makeInboxService();
      await expect(
        service.replyToComment('org-1', 'integration-1', 'comment-1', '   ')
      ).rejects.toThrow('Reply message is required');
    });

    it('delegates to provider.replyToInboxItem with a COMMENT target built from the remote id', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const replyToInboxItem = jest
        .fn()
        .mockResolvedValue({ remoteId: 'new-reply-1' });
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            replyToInboxItem,
          }),
        },
      });

      const result = await service.replyToComment(
        'org-1',
        'integration-1',
        'comment-1',
        '  hello  '
      );

      expect(result).toEqual({ replyRemoteId: 'new-reply-1' });
      expect(replyToInboxItem).toHaveBeenCalledWith(
        'token',
        { type: 'COMMENT', remoteId: 'comment-1' },
        'hello',
        integration
      );
    });
  });
});

describe('InboxService - self-heals an expired access token instead of disconnecting', () => {
  // Root cause: a 401 from the provider (RefreshToken) is the normal signal
  // that the access token expired and should be renewed from the stored
  // refresh token - exactly what IntegrationService.checkAnalytics already
  // does for the Analytics tab. InboxService used to treat that same signal
  // as "give up and mark the channel disconnected", which is why reacting to
  // comments (and every other inbox action) stayed broken until the user
  // visited Analytics and healed the token there instead.
  describe('likeComment', () => {
    it('retries with a refreshed token after a 401 instead of disconnecting the channel', async () => {
      const integration = {
        id: 'integration-1',
        token: 'expired-token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const likeInboxComment = jest
        .fn()
        .mockRejectedValueOnce(new RefreshToken('integration-1', '{}', '{}'))
        .mockResolvedValueOnce({ liked: true, likeCount: 5 });
      const { service, refreshIntegrationService } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            likeInboxComment,
          }),
        },
        refreshIntegrationService: {
          refresh: jest
            .fn()
            .mockResolvedValue({ accessToken: 'fresh-token', expiresIn: 3600 }),
        },
      });

      const result = await service.likeComment(
        'org-1',
        'integration-1',
        'comment-1',
        true
      );

      expect(result).toEqual({ liked: true, likeCount: 5 });
      expect(refreshIntegrationService.refresh).toHaveBeenCalledWith(integration);
      expect(likeInboxComment).toHaveBeenNthCalledWith(
        1,
        'expired-token',
        'comment-1',
        true,
        integration
      );
      expect(likeInboxComment).toHaveBeenNthCalledWith(
        2,
        'fresh-token',
        'comment-1',
        true,
        { ...integration, token: 'fresh-token' }
      );
    });

    it('still attempts the action for a channel already flagged refreshNeeded, instead of blocking it upfront', async () => {
      const integration = {
        id: 'integration-1',
        token: 'stale-flag-but-still-valid-token',
        refreshNeeded: true,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const likeInboxComment = jest
        .fn()
        .mockResolvedValue({ liked: true, likeCount: 1 });
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            likeInboxComment,
          }),
        },
      });

      const result = await service.likeComment(
        'org-1',
        'integration-1',
        'comment-1',
        true
      );

      expect(result).toEqual({ liked: true, likeCount: 1 });
      expect(likeInboxComment).toHaveBeenCalledWith(
        'stale-flag-but-still-valid-token',
        'comment-1',
        true,
        integration
      );
    });

    it('throws a reconnect error when the stored refresh token itself is no longer valid', async () => {
      const integration = {
        id: 'integration-1',
        token: 'expired-token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const likeInboxComment = jest
        .fn()
        .mockRejectedValue(new RefreshToken('integration-1', '{}', '{}'));
      const { service, refreshIntegrationService } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            likeInboxComment,
          }),
        },
        refreshIntegrationService: {
          refresh: jest.fn().mockResolvedValue(false),
        },
      });

      await expect(
        service.likeComment('org-1', 'integration-1', 'comment-1', true)
      ).rejects.toThrow('Reconnect the channel before liking inbox comments');
      expect(refreshIntegrationService.refresh).toHaveBeenCalledWith(integration);
    });
  });

  describe('syncOrganization', () => {
    it('reports a single, non-duplicated reconnect message when the refresh token is no longer valid', async () => {
      const integration = {
        id: 'integration-1',
        name: 'My Instagram',
        token: 'expired-token',
        refreshNeeded: false,
        disabled: false,
        deletedAt: null,
        providerIdentifier: 'instagram',
      };
      const fetchInboxItems = jest
        .fn()
        .mockRejectedValue(new RefreshToken('integration-1', '{}', '{}'));
      const { service, refreshIntegrationService } = makeInboxService({
        integrationService: {
          getIntegrationsList: jest.fn().mockResolvedValue([integration]),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({ fetchInboxItems }),
        },
        refreshIntegrationService: {
          refresh: jest.fn().mockResolvedValue(false),
        },
      });

      const result = await service.syncOrganization('org-1');

      expect(result.errors).toEqual(['My Instagram: reconnect required']);
      expect(refreshIntegrationService.refresh).toHaveBeenCalledWith(
        integration
      );
    });

    it('retries a channel that was already flagged refreshNeeded instead of skipping it forever', async () => {
      const integration = {
        id: 'integration-1',
        name: 'My Instagram',
        token: 'stale-flag-but-still-valid-token',
        refreshNeeded: true,
        disabled: false,
        deletedAt: null,
        providerIdentifier: 'instagram',
      };
      const fetchInboxItems = jest.fn().mockResolvedValue([]);
      const { service, refreshIntegrationService } = makeInboxService({
        integrationService: {
          getIntegrationsList: jest.fn().mockResolvedValue([integration]),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({ fetchInboxItems }),
        },
      });

      const result = await service.syncOrganization('org-1');

      expect(result.errors).toEqual([]);
      expect(fetchInboxItems).toHaveBeenCalledWith('stale-flag-but-still-valid-token', integration);
      expect(refreshIntegrationService.refresh).not.toHaveBeenCalled();
    });
  });
});
