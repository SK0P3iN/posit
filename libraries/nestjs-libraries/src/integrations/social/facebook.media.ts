// facebook.media.ts
import { spawn, execFile } from 'child_process';
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import sharp from 'sharp';
import { lookup } from 'mime-types';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const execFileAsync = promisify(execFile);

export const FACEBOOK_MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const FACEBOOK_MAX_VIDEO_INPUT_BYTES = 500 * 1024 * 1024;

export class FacebookMediaCompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookMediaCompressionError';
  }
}

const IMAGE_WIDTHS = [2048, 1638, 1310, 1048, 838, 670, 536, 428, 342, 274];

const isHttpUrl = (path: string) => /^https?:\/\//i.test(path);

async function fetchMedia(mediaUrl: string): Promise<Response> {
  const response = await fetch(mediaUrl, {
    headers: { 'accept-encoding': 'identity' },
    // @ts-ignore - undici-only option; blocks SSRF to internal IPs
    dispatcher: getSsrfSafeDispatcher(),
  });
  if (!response.ok) {
    throw new FacebookMediaCompressionError(
      `Could not download media for Facebook compression: ${response.status} ${response.statusText}`
    );
  }
  return response;
}

async function readImage(mediaUrl: string): Promise<Buffer> {
  if (!isHttpUrl(mediaUrl)) {
    return readFileSync(mediaUrl);
  }
  const response = await fetchMedia(mediaUrl);
  return Buffer.from(await response.arrayBuffer());
}

async function streamVideoToFile(
  mediaUrl: string,
  inputPath: string
): Promise<void> {
  let source: Readable;

  if (isHttpUrl(mediaUrl)) {
    const response = await fetchMedia(mediaUrl);
    if (!response.body) {
      throw new FacebookMediaCompressionError(
        'Could not download media for Facebook compression: empty response body'
      );
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > FACEBOOK_MAX_VIDEO_INPUT_BYTES) {
      throw new FacebookMediaCompressionError(
        'Video exceeds the 500MB input limit for Facebook compression'
      );
    }
    source = Readable.fromWeb(response.body as any);
  } else {
    source = createReadStream(mediaUrl);
  }

  let downloadedBytes = 0;
  const sizeLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > FACEBOOK_MAX_VIDEO_INPUT_BYTES) {
        callback(
          new FacebookMediaCompressionError(
            'Video exceeds the 500MB input limit for Facebook compression'
          )
        );
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(source, sizeLimiter, createWriteStream(inputPath));
  } catch (error) {
    if (error instanceof FacebookMediaCompressionError) {
      throw error;
    }
    throw new FacebookMediaCompressionError(
      `Could not download video for Facebook compression: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function compressImageForFacebook(
  mediaUrl: string
): Promise<{ buffer: Buffer; mime: 'image/jpeg' | 'image/png' }> {
  const raw = await readImage(mediaUrl);
  const mime = lookup(mediaUrl) || '';
  const isGif = mime === 'image/gif' || mediaUrl.toLowerCase().endsWith('.gif');
  const keepPng = mime === 'image/png' && !isGif;
  const outputMime = keepPng ? 'image/png' : 'image/jpeg';

  let best = raw;
  let quality = 85;

  for (let i = 0; i < IMAGE_WIDTHS.length; i++) {
    const width = IMAGE_WIDTHS[i];
    let pipeline = sharp(raw, { animated: false }).resize({
      width,
      height: width,
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (outputMime === 'image/png') {
      pipeline = pipeline.png({ quality: Math.max(quality, 10) });
    } else {
      pipeline = pipeline.jpeg({ quality: Math.max(quality, 10) });
    }

    best = await pipeline.toBuffer();
    if (best.length <= FACEBOOK_MAX_MEDIA_BYTES) {
      return { buffer: best, mime: outputMime };
    }

    quality -= 10;
  }

  const bestMb = (best.length / (1024 * 1024)).toFixed(1);
  throw new FacebookMediaCompressionError(
    `Could not compress media below Facebook's 10MB limit (best result: ${bestMb}MB). Try a shorter video or smaller image.`
  );
}

const VIDEO_WIDTHS = [1280, 854, 640, 480, 360, 320, 240, 180];

async function probeDurationSeconds(inputPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    const seconds = parseFloat(String(stdout).trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new FacebookMediaCompressionError(
        'Could not inspect video for Facebook compression. The video may be invalid or corrupt.'
      );
    }
    return seconds;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new FacebookMediaCompressionError(
        'Video compression unavailable — ffmpeg is not installed on this server'
      );
    }
    if (error instanceof FacebookMediaCompressionError) {
      throw error;
    }
    throw new FacebookMediaCompressionError(
      'Could not inspect video for Facebook compression. The video may be invalid or corrupt.'
    );
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new FacebookMediaCompressionError(
            'Video compression unavailable — ffmpeg is not installed on this server'
          )
        );
        return;
      }
      reject(
        new FacebookMediaCompressionError(
          `Could not start ffmpeg for Facebook compression. The video may be invalid or corrupt: ${err.message}`
        )
      );
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const detail = (stderr || `ffmpeg exited ${code}`).trim().slice(-1000);
        reject(
          new FacebookMediaCompressionError(
            `Could not encode video for Facebook compression. The video may be invalid or corrupt: ${detail}`
          )
        );
      }
    });
  });
}

export async function compressVideoForFacebook(
  mediaUrl: string,
  uploadFile: (file: Express.Multer.File) => Promise<{ path: string }>
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'fb-video-'));
  const inputPath = join(dir, 'input.mp4');
  const outputPath = join(dir, 'output.mp4');

  try {
    await streamVideoToFile(mediaUrl, inputPath);
    const duration = await probeDurationSeconds(inputPath);

    let bestSize = Infinity;
    let bitrateK = Math.max(
      100,
      Math.floor((FACEBOOK_MAX_MEDIA_BYTES * 8 * 0.85) / duration / 1000)
    );

    for (let i = 0; i < VIDEO_WIDTHS.length; i++) {
      const width = VIDEO_WIDTHS[i];

      await runFfmpeg([
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-b:v',
        `${bitrateK}k`,
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        '-vf',
        `scale=${width}:-2`,
        outputPath,
      ]);

      const { size } = statSync(outputPath);
      bestSize = size;

      if (size <= FACEBOOK_MAX_MEDIA_BYTES) {
        const buffer = readFileSync(outputPath);
        const uploaded = await uploadFile({
          buffer,
          mimetype: 'video/mp4',
          size: buffer.length,
          originalname: 'facebook-compressed.mp4',
          fieldname: 'file',
          encoding: '7bit',
          destination: '',
          filename: 'facebook-compressed.mp4',
          path: outputPath,
          stream: undefined as any,
        });
        return uploaded.path;
      }

      bitrateK = Math.max(100, Math.floor(bitrateK * 0.75));
    }

    const bestMb = (bestSize / (1024 * 1024)).toFixed(1);
    throw new FacebookMediaCompressionError(
      `Could not compress media below Facebook's 10MB limit (best result: ${bestMb}MB). Try a shorter video or smaller image.`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
