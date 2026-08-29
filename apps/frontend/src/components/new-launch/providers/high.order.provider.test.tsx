// high.order.provider.tsx transitively imports InternalChannels, which
// pulls in @copilotkit/react-core (and, via new-modal.tsx, react-hotkeys-hook)
// - both ESM-only packages this project's minimal Jest config doesn't
// transform. This test only exercises the exported pure `getOversizedMedia`
// function (per the plan, `Wrapped` itself isn't rendered here), so stub
// that module out rather than teaching Jest to transpile unrelated
// third-party ESM packages.
jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));

import { getOversizedMedia } from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

describe('getOversizedMedia', () => {
  it('returns no warnings when no limits are declared', () => {
    const result = getOversizedMedia(
      [{ media: [{ path: 'https://cdn/img.png', fileSize: 10_000_000 }] }],
      undefined
    );
    expect(result).toEqual([]);
  });

  it('returns no warnings when media is within the image limit', () => {
    const result = getOversizedMedia(
      [{ media: [{ path: 'https://cdn/img.png', fileSize: 1 * 1024 * 1024 }] }],
      { image: { maxSizeBytes: 4 * 1024 * 1024 } }
    );
    expect(result).toEqual([]);
  });

  it('warns when a photo exceeds the declared image limit', () => {
    const result = getOversizedMedia(
      [{ media: [{ path: 'https://cdn/img.png', fileSize: 5 * 1024 * 1024 }] }],
      { image: { maxSizeBytes: 4 * 1024 * 1024 } }
    );
    expect(result).toEqual([
      'Photo is 5.0MB, over the 4.0MB limit for this channel',
    ]);
  });

  it('classifies .mp4 as video and applies the video limit', () => {
    const result = getOversizedMedia(
      [{ media: [{ path: 'https://cdn/clip.mp4', fileSize: 5 * 1024 * 1024 }] }],
      { video: { maxSizeBytes: 4 * 1024 * 1024 } }
    );
    expect(result).toEqual([
      'Video is 5.0MB, over the 4.0MB limit for this channel',
    ]);
  });

  it('skips media with no known fileSize (e.g. not yet re-uploaded since this feature shipped)', () => {
    const result = getOversizedMedia(
      [{ media: [{ path: 'https://cdn/img.png' }] }],
      { image: { maxSizeBytes: 4 * 1024 * 1024 } }
    );
    expect(result).toEqual([]);
  });
});
