import { SocialAbstract } from './social.abstract';

class TestProvider extends SocialAbstract {
  identifier = 'test';
}

describe('SocialAbstract.checkMediaLimits', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  it('passes through when the provider declares no limits', async () => {
    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(true);
  });

  it('passes when media is within the declared image limit', async () => {
    provider.mediaLimits = { image: { maxSizeBytes: 4 * 1024 * 1024 } };
    jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(1 * 1024 * 1024);

    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(true);
  });

  it('fails with a descriptive message when a photo exceeds the declared limit', async () => {
    provider.mediaLimits = { image: { maxSizeBytes: 4 * 1024 * 1024 } };
    jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(5 * 1024 * 1024);

    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(
      'Photo exceeds the test limit of 4.0MB (currently 5.0MB)'
    );
  });

  it('classifies .mp4 as video and applies the video limit instead of the image limit', async () => {
    provider.mediaLimits = {
      image: { maxSizeBytes: 1 },
      video: { maxSizeBytes: 4 * 1024 * 1024 },
    };
    jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(5 * 1024 * 1024);

    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/clip.mp4' }],
    ]);
    expect(result).toBe(
      'Video exceeds the test limit of 4.0MB (currently 5.0MB)'
    );
  });

  it('skips media whose type has no declared limit', async () => {
    provider.mediaLimits = { video: { maxSizeBytes: 1 } };
    const mediaSizeSpy = jest
      .spyOn(provider as any, 'mediaSize')
      .mockResolvedValue(5 * 1024 * 1024);

    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(true);
    expect(mediaSizeSpy).not.toHaveBeenCalled();
  });

  it('fails open (does not block) when mediaSize() throws', async () => {
    provider.mediaLimits = { image: { maxSizeBytes: 4 * 1024 * 1024 } };
    jest
      .spyOn(provider as any, 'mediaSize')
      .mockRejectedValue(new Error('network error'));

    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(true);
  });
});

describe('SocialAbstract - inbox likes/thread defaults', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  it('inboxCapabilities() defaults likes to false', () => {
    expect(provider.inboxCapabilities().likes).toBe(false);
  });

  it('inboxCapabilities() defaults threads to false', () => {
    expect(provider.inboxCapabilities().threads).toBe(false);
  });

  it('fetchInboxThread throws for a provider that has not implemented it', async () => {
    await expect(
      provider.fetchInboxThread('token', 'post-1', {} as any)
    ).rejects.toThrow('Inbox thread view is not supported for this channel');
  });

  it('likeInboxComment throws for a provider that has not implemented it', async () => {
    await expect(
      provider.likeInboxComment('token', 'comment-1', true, {} as any)
    ).rejects.toThrow('Inbox comment likes are not supported for this channel');
  });
});
