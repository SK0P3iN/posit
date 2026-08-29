// MediaService reaches into an apps/backend-only path for an exception class
// this package's Jest config has no alias for. It's irrelevant to saveFile,
// so stub it the same way posts.service.spec.ts stubs unrelated heavy imports.
jest.mock(
  '@gitroom/backend/services/auth/permissions/permission.exception.class',
  () => ({
    AuthorizationActions: {},
    Sections: {},
    SubscriptionException: class extends Error {},
  }),
  { virtual: true }
);

// MediaService also statically imports SubscriptionService, which transitively
// imports IntegrationManager -> nostr.provider.ts -> nostr-tools, an ESM-only
// dependency this package's isolatedModules ts-jest config can't parse. Same
// root cause posts.service.spec.ts already stubs around; we never call the
// real IntegrationManager here (saveFile doesn't touch subscriptions), so
// stub it out the same way.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import { MediaService } from './media.service';

describe('MediaService.saveFile', () => {
  it('forwards the file size through to the repository', async () => {
    const mediaRepository = {
      saveFile: jest.fn().mockResolvedValue({ id: 'media-1' }),
    };
    const service = new MediaService(
      mediaRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.saveFile(
      'org-1',
      'photo.png',
      'uploads/photo.png',
      'original.png',
      undefined,
      5_242_880
    );

    expect(mediaRepository.saveFile).toHaveBeenCalledWith(
      'org-1',
      'photo.png',
      'uploads/photo.png',
      'original.png',
      undefined,
      5_242_880
    );
  });
});
