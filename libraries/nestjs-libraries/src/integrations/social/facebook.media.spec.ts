// facebook.media.spec.ts
import { spawn } from 'child_process';
import {
  compressImageForFacebook,
  compressVideoForFacebook,
  FACEBOOK_MAX_MEDIA_BYTES,
} from './facebook.media';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdtempSync: jest.fn(() => '/tmp/fb-video-test'),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => Buffer.alloc(2 * 1024 * 1024)),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
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

import { execFile } from 'child_process';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { statSync } from 'fs';
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

describe('compressVideoForFacebook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a public URL when ffmpeg output is under 4MB', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(100));
    (statSync as jest.Mock).mockReturnValue({ size: 2 * 1024 * 1024 });
    (execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string) => void) => {
        cb(null, '10.0');
      }
    );
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const emitter: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          if (event === 'close') setImmediate(() => cb(0));
        }),
      };
      return emitter;
    });

    const uploadFile = jest
      .fn()
      .mockResolvedValue({ path: 'https://example.com/uploads/compressed.mp4' });
    const url = await compressVideoForFacebook(
      'https://cdn/video.mp4',
      uploadFile
    );
    expect(url).toBe('https://example.com/uploads/compressed.mp4');
    expect(uploadFile).toHaveBeenCalled();
  });

  it('throws when ffmpeg is not installed', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(100));
    (execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string) => void) => {
        cb(null, '10.0');
      }
    );
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const emitter: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          if (event === 'error') {
            setImmediate(() => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
          }
        }),
      };
      return emitter;
    });

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toThrow(/ffmpeg is not installed/);
  });
});
