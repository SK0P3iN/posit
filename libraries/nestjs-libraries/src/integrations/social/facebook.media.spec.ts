// facebook.media.spec.ts
import { spawn } from 'child_process';
import { Readable } from 'stream';
import {
  compressImageForFacebook,
  compressVideoForFacebook,
  FACEBOOK_MAX_MEDIA_BYTES,
} from './facebook.media';

jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({
    getSsrfSafeDispatcher: jest.fn(() => 'safe-dispatcher'),
  })
);

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdtempSync: jest.fn(() => '/tmp/fb-video-test'),
  createReadStream: jest.fn(() =>
    require('stream').Readable.from([Buffer.alloc(100)])
  ),
  createWriteStream: jest.fn(
    () =>
      new (require('stream').Writable)({
        write(
          _chunk: Buffer,
          _encoding: BufferEncoding,
          callback: (error?: Error | null) => void
        ) {
          callback();
        },
      })
  ),
  readFileSync: jest.fn(() => Buffer.alloc(2 * 1024 * 1024)),
  statSync: jest.fn(),
  rmSync: jest.fn(),
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
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import sharp from 'sharp';

const fetchMock = jest.fn();
global.fetch = fetchMock as typeof fetch;

function remoteResponse(
  body = Buffer.alloc(100),
  contentLength = body.length
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'content-length'
          ? String(contentLength)
          : null
      ),
    },
    body: Readable.toWeb(Readable.from([body])),
    arrayBuffer: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function mockProbe(duration = '10.0') {
  (execFile as unknown as jest.Mock).mockImplementation(
    (
      _cmd: string,
      _args: string[],
      cb: (err: null, result: { stdout: string }) => void
    ) => cb(null, { stdout: duration })
  );
}

function mockSuccessfulFfmpeg() {
  (spawn as unknown as jest.Mock).mockImplementation(() => {
    const emitter: any = {
      stderr: { on: jest.fn() },
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      }),
    };
    return emitter;
  });
}

describe('compressImageForFacebook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads remote images with the SSRF-safe dispatcher', async () => {
    fetchMock.mockResolvedValue(remoteResponse(Buffer.alloc(8 * 1024 * 1024)));
    // First pass too big, second pass ok
    (sharp as any).toBuffer
      .mockResolvedValueOnce(Buffer.alloc(12 * 1024 * 1024))
      .mockResolvedValueOnce(Buffer.alloc(9 * 1024 * 1024));

    const result = await compressImageForFacebook('https://cdn/photo.jpg');
    expect(result.buffer.length).toBeLessThanOrEqual(FACEBOOK_MAX_MEDIA_BYTES);
    expect(result.mime).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn/photo.jpg',
      expect.objectContaining({ dispatcher: 'safe-dispatcher' })
    );
    expect(getSsrfSafeDispatcher).toHaveBeenCalled();
  });

  it('reads local images without making an HTTP request', async () => {
    (sharp as any).toBuffer.mockResolvedValue(Buffer.alloc(1024));

    await compressImageForFacebook('/uploads/photo.jpg');

    expect(readFileSync).toHaveBeenCalledWith('/uploads/photo.jpg');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when compression cannot reach the limit', async () => {
    fetchMock.mockResolvedValue(remoteResponse(Buffer.alloc(1024)));
    (sharp as any).toBuffer.mockResolvedValue(Buffer.alloc(12 * 1024 * 1024));

    await expect(
      compressImageForFacebook('https://cdn/huge.jpg')
    ).rejects.toThrow(/Could not compress media below Facebook's 10MB limit/);
  });
});

describe('compressVideoForFacebook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams remote video with SSRF protection and removes the temp directory', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    (statSync as jest.Mock).mockReturnValue({ size: 2 * 1024 * 1024 });
    mockProbe();
    mockSuccessfulFfmpeg();

    const uploadFile = jest
      .fn()
      .mockResolvedValue({ path: 'https://example.com/uploads/compressed.mp4' });
    const url = await compressVideoForFacebook(
      'https://cdn/video.mp4',
      uploadFile
    );
    expect(url).toBe('https://example.com/uploads/compressed.mp4');
    expect(uploadFile).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn/video.mp4',
      expect.objectContaining({
        dispatcher: 'safe-dispatcher',
        headers: { 'accept-encoding': 'identity' },
      })
    );
    expect(createWriteStream).toHaveBeenCalledWith(
      '/tmp/fb-video-test/input.mp4'
    );
    expect(rmSync).toHaveBeenCalledWith('/tmp/fb-video-test', {
      recursive: true,
      force: true,
    });
  });

  it('streams local video into the temp input file', async () => {
    (statSync as jest.Mock).mockReturnValue({ size: 2 * 1024 * 1024 });
    mockProbe();
    mockSuccessfulFfmpeg();

    await compressVideoForFacebook(
      '/uploads/video.mp4',
      jest
        .fn()
        .mockResolvedValue({ path: 'https://example.com/compressed.mp4' })
    );

    expect(createReadStream).toHaveBeenCalledWith('/uploads/video.mp4');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects remote video larger than the 500MB input cap', async () => {
    fetchMock.mockResolvedValue(
      remoteResponse(Buffer.alloc(1), 500 * 1024 * 1024 + 1)
    );

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toThrow(/500MB input limit/);
    expect(spawn).not.toHaveBeenCalled();
    expect(rmSync).toHaveBeenCalled();
  });

  it('reduces video bitrate by 25 percent after an oversized result', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    (statSync as jest.Mock)
      .mockReturnValueOnce({ size: 12 * 1024 * 1024 })
      .mockReturnValueOnce({ size: 9 * 1024 * 1024 });
    mockProbe();
    mockSuccessfulFfmpeg();

    await compressVideoForFacebook(
      'https://cdn/video.mp4',
      jest.fn().mockResolvedValue({ path: 'https://example.com/compressed.mp4' })
    );

    const firstArgs = (spawn as unknown as jest.Mock).mock.calls[0][1];
    const secondArgs = (spawn as unknown as jest.Mock).mock.calls[1][1];
    expect(firstArgs[firstArgs.indexOf('-b:v') + 1]).toBe('7130k');
    expect(secondArgs[secondArgs.indexOf('-b:v') + 1]).toBe('5347k');
  });

  it('maps ffprobe ENOENT to the ffmpeg installation error', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    (execFile as unknown as jest.Mock).mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb: (err: NodeJS.ErrnoException) => void
      ) => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    );

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toThrow(/ffmpeg is not installed/);
  });

  it('maps invalid ffprobe input to a compression error', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    (execFile as unknown as jest.Mock).mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb: (err: Error) => void
      ) => cb(new Error('Invalid data found'))
    );

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'FacebookMediaCompressionError',
        message: expect.stringMatching(/invalid or corrupt/i),
      })
    );
  });

  it('throws when ffmpeg is not installed', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    mockProbe();
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const emitter: any = {
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

  it('maps ffmpeg failures to a descriptive compression error', async () => {
    fetchMock.mockResolvedValue(remoteResponse());
    mockProbe();
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const stderrHandlers: Array<(data: Buffer) => void> = [];
      const emitter: any = {
        stderr: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') stderrHandlers.push(cb);
          }),
        },
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          if (event === 'close') {
            setImmediate(() => {
              stderrHandlers.forEach((cb) =>
                cb(Buffer.from('Invalid data found'))
              );
              cb(1);
            });
          }
        }),
      };
      return emitter;
    });

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'FacebookMediaCompressionError',
        message: expect.stringMatching(/invalid or corrupt/i),
      })
    );
  });
});
