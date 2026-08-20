import { GRAPH_API_VERSION, InstagramProvider } from './instagram.provider';
import { Integration } from '@prisma/client';

// Every call this provider makes is either through global fetch or through
// this.fetch (SocialAbstract's wrapper, which itself calls global fetch).
// Mocking global fetch therefore covers both call styles without touching
// the network.
const jsonResponse = (body: any, status = 200) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

describe('InstagramProvider - Graph API version (R13/U1)', () => {
  let provider: InstagramProvider;
  let fetchMock: jest.Mock;
  let calledUrls: string[];

  beforeEach(() => {
    provider = new InstagramProvider();
    calledUrls = [];
    fetchMock = jest.fn(async (url: any) => {
      calledUrls.push(String(url));
      return jsonResponse({});
    });
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectOnlyGraphApiVersion = (urls: string[]) => {
    const graphUrls = urls.filter(
      (u) => u.includes('graph.facebook.com') || u.includes('graph.instagram.com')
    );
    expect(graphUrls.length).toBeGreaterThan(0);
    for (const url of graphUrls) {
      expect(url).not.toMatch(/\/v(20|21)\.0\//);
      expect(url).toContain(`/${GRAPH_API_VERSION}/`);
    }
  };

  it('exposes a single shared constant targeting v22.0', () => {
    expect(GRAPH_API_VERSION).toBe('v22.0');
  });

  describe('OAuth dialog and token exchange', () => {
    it('generateAuthUrl builds the dialog URL on the shared version', async () => {
      const { url } = await provider.generateAuthUrl();
      expect(url.startsWith(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`)).toBe(
        true
      );
      expect(url).not.toContain('v20.0');
    });

    it('authenticate exchanges tokens, checks scopes and fetches the profile on the shared version', async () => {
      let call = 0;
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        call += 1;
        if (call === 1) {
          // initial code -> short-lived token exchange
          return jsonResponse({ access_token: 'short-lived' });
        }
        if (call === 2) {
          // short-lived -> long-lived token exchange
          return jsonResponse({ access_token: 'long-lived', expires_in: 5184000 });
        }
        if (call === 3) {
          // permissions check - Meta's existing response shape
          return jsonResponse({
            data: provider.scopes.map((permission) => ({
              permission,
              status: 'granted',
            })),
          });
        }
        // profile fetch
        return jsonResponse({
          id: 'user-1',
          name: 'Test User',
          picture: { data: { url: 'https://example.com/pic.png' } },
        });
      });

      const result = await provider.authenticate({
        code: 'auth-code',
        codeVerifier: 'verifier',
        refresh: '',
      });

      expect(result).toMatchObject({
        id: 'user-1',
        name: 'Test User',
        accessToken: 'long-lived',
        picture: 'https://example.com/pic.png',
      });
      expectOnlyGraphApiVersion(calledUrls);
      expect(
        calledUrls.filter((u) => u.includes('oauth/access_token'))
      ).toHaveLength(2);
    });
  });

  describe('page and business discovery', () => {
    it('pages() paginates over accounts and businesses using the shared version', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        // No connected pages/businesses - just verifying the call sites/URLs.
        return jsonResponse({ data: [] });
      });

      const result = await provider.pages('access___user');

      expect(result).toEqual([]);
      expectOnlyGraphApiVersion(calledUrls);
      expect(calledUrls.some((u) => u.includes('/me/accounts?'))).toBe(true);
      expect(calledUrls.some((u) => u.includes('/me/businesses?'))).toBe(true);
    });

    it('fetchPageInformation() resolves page + IG business account on the shared version and parses Meta\'s response shape', async () => {
      let call = 0;
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        call += 1;
        if (call === 1) {
          return jsonResponse({
            access_token: 'page-token',
            name: 'Page Name',
            picture: { data: { url: 'https://example.com/page.png' } },
          });
        }
        return jsonResponse({
          id: 'ig-business-1',
          name: 'IG Name',
          profile_picture_url: 'https://example.com/ig.png',
          username: 'ig_handle',
        });
      });

      const info = await provider.fetchPageInformation('access___user', {
        pageId: 'page-1',
        id: 'ig-business-1',
      });

      expect(info).toMatchObject({
        id: 'ig-business-1',
        name: 'IG Name',
        picture: 'https://example.com/ig.png',
        username: 'ig_handle',
        access_token: 'page-token___access',
      });
      expectOnlyGraphApiVersion(calledUrls);
    });
  });

  describe('container create (postPending)', () => {
    const baseIntegration = {} as Integration;

    const buildPost = (overrides: any) => [
      {
        id: 'post-1',
        message: 'hello world',
        media: overrides.media,
        settings: {
          post_type: overrides.postType || 'post',
          ...overrides.settings,
        },
      } as any,
    ];

    it('uses the shared version for an image container', async () => {
      await provider.postPending(
        'ig-id',
        'access___user',
        buildPost({ media: [{ path: 'https://cdn/img.png' }] }),
        baseIntegration
      );
      expectOnlyGraphApiVersion(calledUrls);
      expect(
        calledUrls.some((u) => u.includes(`/${GRAPH_API_VERSION}/ig-id/media?image_url=`))
      ).toBe(true);
    });

    it('uses the shared version for a single video (Reel) container', async () => {
      await provider.postPending(
        'ig-id',
        'access___user',
        buildPost({ media: [{ path: 'https://cdn/video.mp4' }] }),
        baseIntegration
      );
      expectOnlyGraphApiVersion(calledUrls);
      expect(
        calledUrls.some(
          (u) =>
            u.includes(`/${GRAPH_API_VERSION}/ig-id/media?video_url=`) &&
            u.includes('media_type=REELS')
        )
      ).toBe(true);
    });

    it('uses the shared version for a Story container', async () => {
      await provider.postPending(
        'ig-id',
        'access___user',
        buildPost({ media: [{ path: 'https://cdn/img.png' }], postType: 'story' }),
        baseIntegration
      );
      expectOnlyGraphApiVersion(calledUrls);
      expect(
        calledUrls.some(
          (u) =>
            u.includes(`/${GRAPH_API_VERSION}/ig-id/media?image_url=`) &&
            u.includes('media_type=STORIES')
        )
      ).toBe(true);
    });

    it('uses the shared version for every item of a carousel container', async () => {
      await provider.postPending(
        'ig-id',
        'access___user',
        buildPost({
          media: [{ path: 'https://cdn/img1.png' }, { path: 'https://cdn/img2.png' }],
        }),
        baseIntegration
      );
      expectOnlyGraphApiVersion(calledUrls);
      const carouselCalls = calledUrls.filter((u) => u.includes('is_carousel_item=true'));
      expect(carouselCalls).toHaveLength(2);
    });
  });

  describe('media_publish, igContainerStatus and igPermalink', () => {
    it('checkPostStatus polls container status on the shared version', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'FINISHED', status: 'ok' });
      });

      const result = await provider.checkPostStatus(
        'access___user',
        {
          type: 'graph.facebook.com',
          postType: 'single',
          containers: ['container-1'],
        },
        {} as Integration
      );

      expect(result.status).toBe('ready');
      expectOnlyGraphApiVersion(calledUrls);
    });

    it('checkPostStatus keeps polling (pending) while the container is IN_PROGRESS', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'IN_PROGRESS', status: 'in progress' });
      });

      const result = await provider.checkPostStatus(
        'access___user',
        {
          type: 'graph.facebook.com',
          postType: 'single',
          containers: ['container-1'],
        },
        {} as Integration
      );

      expect(result).toEqual({
        status: 'pending',
        pendingData: {
          type: 'graph.facebook.com',
          postType: 'single',
          containers: ['container-1'],
        },
      });
    });

    // R14: an unrecognized status code must never be silently treated as
    // ready - only an exact FINISHED (or already-handled PUBLISHED) match
    // may resolve the container to 'ready'/'completed'.
    it('checkPostStatus does not resolve to ready on an unrecognized status code', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'SOME_UNKNOWN_STATUS', status: 'ok' });
      });

      const result = await provider.checkPostStatus(
        'access___user',
        {
          type: 'graph.facebook.com',
          postType: 'single',
          containers: ['container-1'],
        },
        {} as Integration
      );

      expect(result.status).not.toBe('ready');
      expect(result.status).toBe('pending');
    });

    it('checkPostStatus does not resolve to ready on an unrecognized status code (carousel branch)', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'SOME_UNKNOWN_STATUS', status: 'ok' });
      });

      const result = await provider.checkPostStatus(
        'access___user',
        {
          type: 'graph.facebook.com',
          postType: 'carousel',
          containers: ['container-1', 'container-2'],
          carouselId: 'carousel-1',
        },
        {} as Integration
      );

      expect(result.status).not.toBe('ready');
      expect(result.status).toBe('pending');
    });

    it('checkPostStatus/igContainerStatus still throws on ERROR exactly as before', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'ERROR', status: 'Media could not be processed' });
      });

      await expect(
        provider.checkPostStatus(
          'access___user',
          {
            type: 'graph.facebook.com',
            postType: 'single',
            containers: ['container-1'],
          },
          {} as Integration
        )
      ).rejects.toThrow();
    });

    it('checkPostStatus/igContainerStatus still throws on EXPIRED exactly as before', async () => {
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        return jsonResponse({ status_code: 'EXPIRED', status: 'Container expired' });
      });

      await expect(
        provider.checkPostStatus(
          'access___user',
          {
            type: 'graph.facebook.com',
            postType: 'single',
            containers: ['container-1'],
          },
          {} as Integration
        )
      ).rejects.toThrow();
    });

    it('finalizePost calls media_publish then igPermalink on the shared version', async () => {
      let call = 0;
      fetchMock.mockImplementation(async (url: any) => {
        calledUrls.push(String(url));
        call += 1;
        if (call === 1) {
          return jsonResponse({ id: 'media-1' });
        }
        return jsonResponse({ permalink: 'https://www.instagram.com/p/abc' });
      });

      const result = await provider.finalizePost(
        'access___user',
        {
          type: 'graph.facebook.com',
          postType: 'single',
          containers: ['container-1'],
        },
        { profile: 'my_profile' } as Integration
      );

      expect(result).toMatchObject({
        status: 'completed',
        postId: 'media-1',
        releaseURL: 'https://www.instagram.com/p/abc',
      });
      expectOnlyGraphApiVersion(calledUrls);
      expect(calledUrls.some((u) => u.includes('media_publish'))).toBe(true);
      expect(calledUrls.some((u) => u.includes('fields=permalink'))).toBe(true);
    });
  });

  describe('handleErrors - unchanged by the version bump', () => {
    it('matches the daily-post-limit error code 2207042', () => {
      const result = provider.handleErrors(
        JSON.stringify({ error: { code: 2207042, message: 'limit' } }),
        400
      );
      expect(result).toEqual({
        type: 'bad-body',
        value: 'You have reached the maximum of 25 posts per day, allowed for your account',
      });
    });

    it('matches the trial-reels-unsupported error code 2207081', () => {
      const result = provider.handleErrors(
        JSON.stringify({ error: { code: 2207081, message: 'trial reels' } }),
        400
      );
      expect(result).toEqual({
        type: 'bad-body',
        value: "This account doesn't support Trial Reels",
      });
    });

    it('matches an invalid access token via error code 190', () => {
      const result = provider.handleErrors(
        JSON.stringify({ error: { message: 'Invalid OAuth', code: 190 } }),
        401
      );
      expect(result).toEqual({
        type: 'refresh-token',
        value: 'The Instagram access token is invalid, please reconnect the channel',
      });
    });

    it('returns undefined for an unrecognized error body', () => {
      const result = provider.handleErrors(
        JSON.stringify({ error: { code: 999999, message: 'something else' } }),
        400
      );
      expect(result).toBeUndefined();
    });
  });
});
