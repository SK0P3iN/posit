import { FacebookProvider } from './facebook.provider';
import { Integration } from '@prisma/client';

describe('FacebookProvider', () => {
  let provider: FacebookProvider;

  beforeEach(() => {
    provider = new FacebookProvider();
  });

  describe('deriveCompanionPosts (U4 - Story Companion Post hook, parity with Instagram)', () => {
    const baseIntegration = { id: 'integration-1' } as Integration;
    const media = [{ type: 'image', path: 'https://cdn/img.png' }] as any;
    const carouselMedia = [
      { type: 'image', path: 'https://cdn/img1.png', id: 'media-1' },
      { type: 'image', path: 'https://cdn/img2.png', id: 'media-2' },
    ] as any;

    const buildContext = (overrides: any) => ({
      operation: 'create' as const,
      postId: 'post-1',
      integration: baseIntegration,
      settings: {},
      media,
      existingCompanion: null,
      ...overrides,
    });

    it('toggle on, single-media post -> upserts settings that route through the Story publish path', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({ settings: { also_share_to_story: true } })
      );

      expect(result.action).toBe('upsert');
      expect((result as any).settings).toEqual({ post_type: 'story' });
      expect((result as any).media).toEqual(media);
    });

    it('toggle off, no existing companion -> none', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({ settings: { also_share_to_story: false } })
      );
      expect(result).toEqual({ action: 'none' });
    });

    it('toggle on, multi-photo carousel with story_media_id set -> uses only that item', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          media: carouselMedia,
          settings: { also_share_to_story: true, story_media_id: 'media-2' },
        })
      );
      expect(result.action).toBe('upsert');
      expect((result as any).media).toEqual([carouselMedia[1]]);
    });

    it('toggle on, carousel with no story_media_id -> defaults to the first item', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          media: carouselMedia,
          settings: { also_share_to_story: true },
        })
      );
      expect(result.action).toBe('upsert');
      expect((result as any).media).toEqual([carouselMedia[0]]);
    });

    it('toggle on, post has no media -> resolves to an empty media array, not [undefined]', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          media: [],
          settings: { also_share_to_story: true, story_media_id: 'media-1' },
        })
      );
      expect(result.action).toBe('upsert');
      expect((result as any).media).toEqual([]);
    });

    it('existing companion already PUBLISHED -> does not regenerate', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          operation: 'update',
          settings: { also_share_to_story: true },
          existingCompanion: {
            id: 'companion-1',
            state: 'PUBLISHED',
            releaseId: 'story-1',
          },
        })
      );
      expect(result).toEqual({ action: 'none' });
    });

    it('existing companion pending, toggle turned off -> cancels', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          operation: 'update',
          settings: { also_share_to_story: false },
          existingCompanion: {
            id: 'companion-1',
            state: 'QUEUE',
            releaseId: null,
          },
        })
      );
      expect(result).toEqual({ action: 'cancel' });
    });

    it('existing companion in-flight (mid arm-confirm-finalize), parent post edited -> does not regenerate or duplicate-publish', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          operation: 'update',
          settings: { also_share_to_story: true },
          existingCompanion: {
            id: 'companion-1',
            state: 'QUEUE',
            releaseId: null,
            inFlight: true,
          },
        })
      );
      expect(result).toEqual({ action: 'none' });
    });

    it('delete, existing companion safely cancelable -> cancels', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          operation: 'delete',
          existingCompanion: {
            id: 'companion-1',
            state: 'QUEUE',
            releaseId: null,
          },
        })
      );
      expect(result).toEqual({ action: 'cancel' });
    });

    it('no existing companion, toggle off -> none (nothing to cancel)', async () => {
      const result = await provider.deriveCompanionPosts(
        buildContext({
          operation: 'delete',
          existingCompanion: null,
        })
      );
      expect(result).toEqual({ action: 'none' });
    });
  });

  describe('FacebookProvider - proactive 4MB photo limit (turns Graph API error 1366046 proactive)', () => {
    it('flags a photo over 4MB before it ever reaches the Graph API', async () => {
      jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(5 * 1024 * 1024);

      const result = await provider.checkMediaLimits([
        [{ path: 'https://cdn/img.png' }],
      ]);
      expect(result).toBe(
        'Photo exceeds the facebook limit of 4.0MB (currently 5.0MB)'
      );
    });

    it('allows a photo within the 4MB limit', async () => {
      jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(1 * 1024 * 1024);

      const result = await provider.checkMediaLimits([
        [{ path: 'https://cdn/img.png' }],
      ]);
      expect(result).toBe(true);
    });

    it('does not apply the photo limit to a video', async () => {
      const mediaSizeSpy = jest
        .spyOn(provider as any, 'mediaSize')
        .mockResolvedValue(50 * 1024 * 1024);

      const result = await provider.checkMediaLimits([
        [{ path: 'https://cdn/clip.mp4' }],
      ]);
      expect(result).toBe(true);
      expect(mediaSizeSpy).not.toHaveBeenCalled();
    });
  });

  describe('FacebookProvider - inbox comment likes and threads', () => {
    const jsonResponse = (body: any, status = 200) =>
      ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response);

    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('inboxCapabilities() reports likes: true', () => {
      expect(provider.inboxCapabilities().likes).toBe(true);
    });

    it('fetchInboxThread maps nested replies into InboxThreadNode.replies', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          comments: {
            data: [
              {
                id: 'c1',
                message: 'top comment',
                from: { id: 'u1', name: 'Alice' },
                created_time: '2026-08-01T00:00:00Z',
                like_count: 2,
                user_likes: true,
                comments: {
                  data: [
                    {
                      id: 'c1-r1',
                      message: 'a reply',
                      from: { id: 'u2', name: 'Bob' },
                      created_time: '2026-08-01T01:00:00Z',
                      like_count: 0,
                      user_likes: false,
                    },
                  ],
                },
              },
            ],
          },
        })
      );

      const result = await provider.fetchInboxThread(
        'token-123',
        'post-1',
        {} as any
      );

      expect(result).toEqual([
        {
          remoteId: 'c1',
          authorName: 'Alice',
          authorId: 'u1',
          authorPicture: null,
          body: 'top comment',
          remoteCreatedAt: '2026-08-01T00:00:00Z',
          replyCapable: true,
          likeCapable: true,
          likeCount: 2,
          likedByMe: true,
          replies: [
            {
              remoteId: 'c1-r1',
              authorName: 'Bob',
              authorId: 'u2',
              authorPicture: null,
              body: 'a reply',
              remoteCreatedAt: '2026-08-01T01:00:00Z',
              replyCapable: true,
              likeCapable: true,
              likeCount: 0,
              likedByMe: false,
              replies: [],
            },
          ],
        },
      ]);
      expect(fetchMock.mock.calls[0][0]).toContain(
        'https://graph.facebook.com/v20.0/post-1'
      );
      expect(fetchMock.mock.calls[0][0]).toContain('access_token=token-123');
    });

    it('likeInboxComment(liked: true) POSTs to /likes and returns the refreshed state', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse({ like_count: 3, user_likes: true }));

      const result = await provider.likeInboxComment(
        'token-123',
        'comment-1',
        true,
        {} as any
      );

      expect(result).toEqual({ liked: true, likeCount: 3 });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://graph.facebook.com/v20.0/comment-1/likes?access_token=token-123'
      );
      expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    });

    it('likeInboxComment(liked: false) DELETEs /likes and returns the refreshed state', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse({ like_count: 1, user_likes: false }));

      const result = await provider.likeInboxComment(
        'token-123',
        'comment-1',
        false,
        {} as any
      );

      expect(result).toEqual({ liked: false, likeCount: 1 });
      expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    });
  });
});
