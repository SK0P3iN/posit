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

describe('MediaService.reorderFolders', () => {
  it('forwards the order pairs to the repository for the requesting organization', async () => {
    const mediaRepository = {
      reorderFolders: jest.fn().mockResolvedValue({ updated: ['folder-1', 'folder-2'] }),
    };
    const service = new MediaService(
      mediaRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const orders = [
      { id: 'folder-1', order: 0 },
      { id: 'folder-2', order: 1 },
    ];

    const result = await service.reorderFolders('org-1', orders);

    expect(mediaRepository.reorderFolders).toHaveBeenCalledWith('org-1', orders);
    expect(result).toEqual({ updated: ['folder-1', 'folder-2'] });
  });
});

describe('MediaService.purgeSelected', () => {
  const buildService = (repositoryOverrides: Record<string, any> = {}) => {
    const mediaRepository = {
      getFolderById: jest.fn(),
      getDescendantFolderIds: jest.fn(),
      getTrashedMediaIdsInFolders: jest.fn(),
      hardDeleteFolderRow: jest.fn(),
      getMediaById: jest.fn(),
      getMediaByIds: jest.fn(),
      hardDeleteMedia: jest.fn(),
      ...repositoryOverrides,
    };
    const service = new MediaService(
      mediaRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    // purgeMedia's storage removal is best-effort and unrelated here; stub it
    // so the cascade test only asserts the repository call sequence.
    jest.spyOn(service as any, 'removeMediaFromStorage').mockResolvedValue(undefined);
    return { service, mediaRepository };
  };

  it('purges a trashed folder cascade child-first and purges only trashed media within it', async () => {
    const { service, mediaRepository } = buildService({
      getFolderById: jest
        .fn()
        .mockResolvedValue({ id: 'folder-root', deletedAt: new Date() }),
      getDescendantFolderIds: jest
        .fn()
        .mockResolvedValue(['folder-root', 'folder-child']),
      getTrashedMediaIdsInFolders: jest
        .fn()
        .mockResolvedValue([{ id: 'media-1' }, { id: 'media-2' }]),
      getMediaById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          organizationId: 'org-1',
          path: `uploads/${id}.png`,
          thumbnail: null,
        })
      ),
    });

    const result = await service.purgeSelected('org-1', undefined, ['folder-root']);

    expect(mediaRepository.getDescendantFolderIds).toHaveBeenCalledWith(
      'org-1',
      'folder-root',
      true
    );
    // Folder rows must be deleted child-first: reversed BFS order.
    expect(mediaRepository.hardDeleteFolderRow.mock.calls.map((call) => call[1])).toEqual([
      'folder-child',
      'folder-root',
    ]);
    expect(result.mediaIds.sort()).toEqual(['media-1', 'media-2']);
    expect(result.folderIds).toEqual(['folder-child', 'folder-root']);
  });

  it('does not purge a folder that is not trashed', async () => {
    const { service, mediaRepository } = buildService({
      getFolderById: jest.fn().mockResolvedValue({ id: 'folder-1', deletedAt: null }),
    });

    const result = await service.purgeSelected('org-1', undefined, ['folder-1']);

    expect(mediaRepository.getDescendantFolderIds).not.toHaveBeenCalled();
    expect(mediaRepository.hardDeleteFolderRow).not.toHaveBeenCalled();
    expect(result).toEqual({ mediaIds: [], folderIds: [] });
  });

  it('does not purge a standalone media item that is not trashed', async () => {
    const { service, mediaRepository } = buildService({
      getMediaByIds: jest
        .fn()
        .mockResolvedValue([{ id: 'media-1', organizationId: 'org-1', deletedAt: null }]),
    });

    const result = await service.purgeSelected('org-1', ['media-1'], undefined);

    expect(result).toEqual({ mediaIds: [], folderIds: [] });
  });

  it('does not purge a media item belonging to a different organization', async () => {
    const { mediaRepository, service } = buildService({
      // getMediaByIds already scopes its WHERE clause to the requesting org,
      // so a foreign-org id is simply absent from the result -- not merely
      // present-but-flagged.
      getMediaByIds: jest.fn().mockResolvedValue([]),
    });

    const result = await service.purgeSelected('org-1', ['media-1'], undefined);

    expect(mediaRepository.getMediaByIds).toHaveBeenCalledWith('org-1', ['media-1']);
    expect(result).toEqual({ mediaIds: [], folderIds: [] });
  });
});
