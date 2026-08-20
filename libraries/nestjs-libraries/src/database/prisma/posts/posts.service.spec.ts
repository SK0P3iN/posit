// posts.service.ts transitively imports create.post.dto.ts -> sanitize.post.content.ts
// -> isomorphic-dompurify, whose own jsdom dependency chain (@exodus/bytes) uses
// ESM syntax Jest's default transform can't parse. We never exercise sanitization
// in this suite, so stub the module out before it's required rather than pulling
// jsdom into this package's minimal, isolatedModules Jest config.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (html: string) => html },
}));

// posts.service.ts also statically imports IntegrationManager purely for its
// constructor parameter type (needed for Nest's emitDecoratorMetadata), but
// IntegrationManager itself imports every social provider at module scope —
// including ones (e.g. nostr.provider.ts -> nostr-tools) that ship ESM-only
// dependencies this package's isolatedModules ts-jest config can't parse.
// We never call the real IntegrationManager (a hand-rolled fake is passed
// into PostsService's constructor below), so stub the module out entirely.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

// Same story for MediaService: it's only here for its constructor parameter
// type, but the real module reaches into `@gitroom/backend/...` (an apps/
// backend-only path this package's Jest config has no alias for) for an
// exception class. Stub it out too — the tests below pass a hand-rolled
// fake for the actual behavior.
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));

import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';

// U3 (R6/R15/R16): Story Companion Post generic derivation hook + schema
// plumbing. PostsService has many constructor dependencies but none of them
// are string-token injections, so — like instagram.provider.spec.ts's
// pattern of `new InstagramProvider()` with a mocked global fetch — we build
// it directly with hand-rolled fakes rather than pulling in
// @nestjs/testing's TestingModule.

const fakeIntegration = {
  id: 'integration-1',
  providerIdentifier: 'instagram-standalone',
};

function makeTemporalServiceFake() {
  return {
    client: {
      getRawClient: jest.fn(() => ({
        workflow: {
          list: jest.fn(() => []),
          start: jest.fn().mockResolvedValue(undefined),
        },
      })),
      getWorkflowHandle: jest.fn(),
    },
  };
}

function makePostsService(overrides?: {
  postRepository?: Partial<Record<string, jest.Mock>>;
  provider?: any;
  subscription?: Partial<Record<string, jest.Mock>>;
  organization?: Partial<Record<string, jest.Mock>>;
}) {
  const postRepository = {
    createOrUpdatePost: jest.fn().mockResolvedValue({
      posts: [
        {
          id: 'feed-post-1',
          publishDate: new Date('2026-01-01T00:00:00Z'),
          state: 'QUEUE',
        },
      ],
    }),
    clearMediaMissing: jest.fn(),
    getCompanionForPost: jest.fn().mockResolvedValue(null),
    upsertCompanionPost: jest.fn().mockResolvedValue({
      id: 'companion-1',
      group: 'companion-group-1',
      state: 'QUEUE',
    }),
    cancelCompanionPost: jest.fn().mockResolvedValue(null),
    countPostsFromDay: jest.fn().mockResolvedValue(0),
    ...overrides?.postRepository,
  } as unknown as PostsRepository;

  const provider = overrides?.provider ?? {
    stripLinks: () => false,
  };

  const integrationManager = {
    getSocialIntegration: jest.fn(() => provider),
  };

  const integrationService = {
    getIntegrationById: jest.fn().mockResolvedValue(fakeIntegration),
  };

  const mediaService = {
    extractMediaIdsFromValues: jest.fn(() => []),
    recordAttachedMedia: jest.fn(),
    getMediaById: jest.fn(),
  };

  const shortLinkService = {
    convertTextToShortLinks: jest.fn(),
  };

  const openaiService = {};
  const temporalService = makeTemporalServiceFake();
  const refreshIntegrationService = {};

  const subscriptionService = {
    getSubscriptionByOrganizationId: jest
      .fn()
      .mockResolvedValue({ subscriptionTier: 'PRO' }),
    getSubscription: jest
      .fn()
      .mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00Z') }),
    ...overrides?.subscription,
  };

  const organizationService = {
    getOrgById: jest
      .fn()
      .mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00Z') }),
    ...overrides?.organization,
  };

  const service = new PostsService(
    postRepository,
    integrationManager as any,
    integrationService as any,
    mediaService as any,
    shortLinkService as any,
    openaiService as any,
    temporalService as any,
    refreshIntegrationService as any,
    subscriptionService as any,
    organizationService as any
  );

  return { service, postRepository, integrationManager, provider };
}

function makeCreatePostBody(type: 'now' | 'schedule' | 'update' | 'draft') {
  return {
    type,
    order: '',
    shortLink: false,
    date: '2026-01-01T00:00:00',
    tags: [],
    posts: [
      {
        group: '',
        integration: { id: 'integration-1' },
        settings: { __type: 'instagram-standalone' } as any,
        value: [{ id: '', content: 'hello world', delay: 0, image: [] }],
      },
    ],
  } as any;
}

describe('PostsService - Story Companion Post derivation (U3, R6/R15/R16)', () => {
  afterEach(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    jest.clearAllMocks();
  });

  it('calls the hook and persists a companion post with its own group when the provider implements it and returns "upsert"', async () => {
    const provider = {
      stripLinks: () => false,
      deriveCompanionPosts: jest.fn().mockResolvedValue({
        action: 'upsert',
        message: 'story caption',
        media: [{ type: 'image', path: '/story.jpg' }],
        settings: { storyToggle: true },
      }),
    };
    const { service, postRepository } = makePostsService({ provider });

    const result = await service.createPost(
      'org-1',
      makeCreatePostBody('now'),
      'WEB' as any
    );

    expect(provider.deriveCompanionPosts).toHaveBeenCalledTimes(1);
    expect(postRepository.upsertCompanionPost).toHaveBeenCalledWith(
      'org-1',
      'feed-post-1',
      'integration-1',
      expect.any(Date),
      'story caption',
      [{ type: 'image', path: '/story.jpg' }],
      { storyToggle: true },
      'WEB'
    );
    // The Feed post itself is still returned/created normally.
    expect(result).toEqual([
      { postId: 'feed-post-1', integration: 'integration-1' },
    ]);
  });

  it('is a no-op for a provider that does not implement the hook', async () => {
    const { service, postRepository } = makePostsService(); // default provider has no deriveCompanionPosts

    await service.createPost('org-1', makeCreatePostBody('now'), 'WEB' as any);

    expect(postRepository.upsertCompanionPost).not.toHaveBeenCalled();
  });

  it('does not create a companion when the org is already at its monthly post cap, but still saves the Feed post', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_dummy';
    const provider = {
      stripLinks: () => false,
      deriveCompanionPosts: jest.fn().mockResolvedValue({
        action: 'upsert',
        message: 'story caption',
        media: [],
        settings: {},
      }),
    };
    const { service, postRepository } = makePostsService({
      provider,
      postRepository: {
        // FREE tier => posts_per_month: 0, so any non-negative count is "at cap"
        countPostsFromDay: jest.fn().mockResolvedValue(0),
      },
      subscription: {
        getSubscriptionByOrganizationId: jest
          .fn()
          .mockResolvedValue({ subscriptionTier: 'FREE' }),
      },
    });

    const result = await service.createPost(
      'org-1',
      makeCreatePostBody('now'),
      'WEB' as any
    );

    expect(postRepository.upsertCompanionPost).not.toHaveBeenCalled();
    // The Feed post itself still saved normally, cap only blocks the companion.
    expect(result).toEqual([
      { postId: 'feed-post-1', integration: 'integration-1' },
    ]);
  });

  it('cancels the companion when the hook returns "cancel"', async () => {
    const provider = {
      stripLinks: () => false,
      deriveCompanionPosts: jest.fn().mockResolvedValue({ action: 'cancel' }),
    };
    const { service, postRepository } = makePostsService({ provider });

    await service.createPost('org-1', makeCreatePostBody('update'), 'WEB' as any);

    expect(postRepository.cancelCompanionPost).toHaveBeenCalledWith(
      'org-1',
      'feed-post-1'
    );
    expect(postRepository.upsertCompanionPost).not.toHaveBeenCalled();
  });

  it('does nothing when the hook returns "none"', async () => {
    const provider = {
      stripLinks: () => false,
      deriveCompanionPosts: jest.fn().mockResolvedValue({ action: 'none' }),
    };
    const { service, postRepository } = makePostsService({ provider });

    await service.createPost('org-1', makeCreatePostBody('now'), 'WEB' as any);

    expect(postRepository.upsertCompanionPost).not.toHaveBeenCalled();
    expect(postRepository.cancelCompanionPost).not.toHaveBeenCalled();
  });
});

describe('PostsRepository - Story Companion Post persistence (U3, KTD2/KTD3)', () => {
  // A minimal fake Prisma `post` delegate that actually implements upsert
  // semantics keyed on whatever `where` key is passed in, so we can prove
  // the unique-constraint-backed upsert collapses two concurrent calls into
  // one row instead of racing into two.
  function makeFakePostDelegate() {
    const rows = new Map<string, any>();
    let counter = 0;
    return {
      rows,
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const [key, value] = Object.entries(where)[0] as [string, any];
        const existing = [...rows.values()].find((r) => r[key] === value);
        if (existing) {
          const updated = { ...existing, ...update };
          rows.set(existing.id, updated);
          return updated;
        }
        const id = `row-${++counter}`;
        const created = { id, [key]: value, ...create };
        rows.set(id, created);
        return created;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
  }

  function makeRepository() {
    const postDelegate = makeFakePostDelegate();
    const repository = new PostsRepository(
      { model: { post: postDelegate } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repository, postDelegate };
  }

  it('collapses two near-simultaneous companion upserts for the same Feed post into exactly one row', async () => {
    const { repository, postDelegate } = makeRepository();

    const [first, second] = await Promise.all([
      repository.upsertCompanionPost(
        'org-1',
        'feed-post-1',
        'integration-1',
        new Date(),
        'caption A',
        [],
        {},
        'WEB' as any
      ),
      repository.upsertCompanionPost(
        'org-1',
        'feed-post-1',
        'integration-1',
        new Date(),
        'caption B',
        [],
        {},
        'WEB' as any
      ),
    ]);

    expect(postDelegate.upsert).toHaveBeenCalledTimes(2);
    for (const call of postDelegate.upsert.mock.calls) {
      expect(call[0].where).toEqual({ storyCompanionOfPostId: 'feed-post-1' });
    }
    // Both calls resolved to the same row id — one companion, not two.
    expect(first.id).toEqual(second.id);
    expect(postDelegate.rows.size).toBe(1);
  });

  it('does not filter dispatch/queue-scan queries in a way that would exclude companion rows', async () => {
    const { repository, postDelegate } = makeRepository();

    await repository.searchForMissingThreeHoursPosts();

    const where = postDelegate.findMany.mock.calls[0][0].where;
    // Companion rows always have parentPostId: null (they are top-level
    // posts linked via storyCompanionOfPostId, not parentPostId), so the
    // existing `parentPostId: null` filter already includes them — as long
    // as nothing here also filters on storyCompanionOfPostId.
    expect(where.parentPostId).toBeNull();
    expect(where).not.toHaveProperty('storyCompanionOfPostId');
  });
});
