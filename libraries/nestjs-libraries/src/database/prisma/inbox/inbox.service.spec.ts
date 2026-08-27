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

function makeInboxService(overrides?: {
  integrationManager?: Partial<Record<string, jest.Mock>>;
  integrationService?: Partial<Record<string, jest.Mock>>;
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

  const service = new InboxService(
    inboxRepository,
    integrationManager as any,
    integrationService as any
  );

  return { service, inboxRepository, integrationManager, integrationService };
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
