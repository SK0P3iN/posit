// facebook.media.spec.ts
import { compressImageForFacebook, FACEBOOK_MAX_MEDIA_BYTES } from './facebook.media';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('sharp', () => {
  const instances: any[] = [];
  const toBuffer = jest.fn();
  const sharpMock = jest.fn(() => {
    const chain = {
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer,
    };
    instances.push(chain);
    return chain;
  });
  (sharpMock as any).instances = instances;
  (sharpMock as any).toBuffer = toBuffer;
  return sharpMock;
});

import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import sharp from 'sharp';

describe('compressImageForFacebook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a buffer within FACEBOOK_MAX_MEDIA_BYTES for a large JPEG', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(8 * 1024 * 1024));
    // First pass too big, second pass ok
    (sharp as any).toBuffer
      .mockResolvedValueOnce(Buffer.alloc(5 * 1024 * 1024))
      .mockResolvedValueOnce(Buffer.alloc(3 * 1024 * 1024));

    const result = await compressImageForFacebook('https://cdn/photo.jpg');
    expect(result.buffer.length).toBeLessThanOrEqual(FACEBOOK_MAX_MEDIA_BYTES);
    expect(result.mime).toBe('image/jpeg');
  });

  it('throws when compression cannot reach the limit', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(1024));
    (sharp as any).toBuffer.mockResolvedValue(Buffer.alloc(5 * 1024 * 1024));

    await expect(
      compressImageForFacebook('https://cdn/huge.jpg')
    ).rejects.toThrow(/Could not compress media below Facebook's 4MB limit/);
  });
});
