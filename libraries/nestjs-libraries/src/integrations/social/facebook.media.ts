// facebook.media.ts
import sharp from 'sharp';
import { lookup } from 'mime-types';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';

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
