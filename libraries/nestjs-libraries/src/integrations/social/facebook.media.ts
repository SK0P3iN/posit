// facebook.media.ts
import { spawn, execFile } from 'child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { lookup } from 'mime-types';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';

const execFileAsync = promisify(execFile);

export const FACEBOOK_MAX_MEDIA_BYTES = 4 * 1024 * 1024;

export class FacebookMediaCompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookMediaCompressionError';
  }
}

const IMAGE_WIDTHS = [2048, 1638, 1310, 1048, 838, 670, 536, 428, 342, 274];

export async function compressImageForFacebook(
  mediaUrl: string
): Promise<{ buffer: Buffer; mime: 'image/jpeg' | 'image/png' }> {
  const raw = Buffer.from(await readOrFetch(mediaUrl));
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
    `Could not compress media below Facebook's 4MB limit (best result: ${bestMb}MB). Try a shorter video or smaller image.`
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
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 10;
  } catch {
    throw new FacebookMediaCompressionError(
      'Video compression unavailable — ffmpeg is not installed on this server'
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
      reject(err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited ${code}`));
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
    writeFileSync(inputPath, Buffer.from(await readOrFetch(mediaUrl)));
    const duration = await probeDurationSeconds(inputPath);

    let bestSize = Infinity;

    for (let i = 0; i < VIDEO_WIDTHS.length; i++) {
      const width = VIDEO_WIDTHS[i];
      const bitrateK = Math.max(
        100,
        Math.floor((FACEBOOK_MAX_MEDIA_BYTES * 8 * 0.85) / duration / 1000)
      );

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
    }

    const bestMb = (bestSize / (1024 * 1024)).toFixed(1);
    throw new FacebookMediaCompressionError(
      `Could not compress media below Facebook's 4MB limit (best result: ${bestMb}MB). Try a shorter video or smaller image.`
    );
  } finally {
    for (const p of [inputPath, outputPath]) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}
