# Facebook Media Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compress and convert Facebook post media (images → JPG/PNG ≤ 4MB, videos → MP4 ≤ 4MB) at post time inside the Facebook provider, hard-failing when compression cannot reach the limit.

**Architecture:** Extract Facebook-specific compression into `facebook.media.ts` (sharp for images, `child_process.spawn` for ffmpeg/ffprobe for videos). `facebook.provider.ts` calls `prepareMediaForFacebook()` before every Graph API upload, switching photo uploads from JSON `{ url }` to multipart `{ source: buffer }` and videos to a temp-compressed public URL. Remove Facebook's schedule-time `mediaLimits` block; compression at post time is the enforcement point.

**Tech Stack:** NestJS, sharp (existing), ffmpeg/ffprobe (new system dep in Docker), form-data (existing), Jest, React frontend provider wrapper.

**Spec:** `docs/superpowers/specs/2026-08-30-facebook-media-compression-design.md`

## Global Constraints

- Facebook-only — no generic `if (facebook)` branches outside `facebook.provider.ts` / `facebook.media.ts` / `facebook.provider.tsx`.
- Hard fail if compressed result still > 4MB (`BadBody` with descriptive message).
- `TARGET_BYTES = 4 * 1024 * 1024` (4MB).
- Original library media is never modified; temp compressed videos uploaded via `UploadFactory.createStorage().uploadFile()`.
- No new npm dependencies for ffmpeg — use `child_process.spawn('ffmpeg', ...)` and `spawn('ffprobe', ...)`.
- No Temporal workflow/activity signature changes.
- Follow existing provider patterns (LinkedIn `prepareMediaBuffer`, Mastodon `form-data` uploads).
- Lint from repo root: `pnpm run lint`.
- Tests from repo root: `pnpm jest <path> --no-cache`.

---

## File map

| File | Responsibility |
|------|----------------|
| `libraries/nestjs-libraries/src/integrations/social/facebook.media.ts` | **Create** — image/video compression helpers |
| `libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts` | **Create** — unit tests for compression helpers |
| `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts` | **Modify** — call compression before uploads; multipart photo upload; remove `mediaLimits` |
| `libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts` | **Modify** — replace `checkMediaLimits` block tests with compression tests |
| `Dockerfile.dev` | **Modify** — install `ffmpeg` |
| `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx` | **Modify** — add optional `mediaCompressionNote` banner |
| `apps/frontend/src/components/new-launch/providers/facebook/facebook.provider.tsx` | **Modify** — remove `mediaLimits`, add `mediaCompressionNote` |

---

### Task 1: Image compression helper

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/facebook.media.ts`
- Create: `libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts`

**Interfaces:**
- Produces: `FACEBOOK_MAX_MEDIA_BYTES`, `compressImageForFacebook(mediaUrl: string): Promise<{ buffer: Buffer; mime: 'image/jpeg' | 'image/png' }>`, `FacebookMediaCompressionError` (extends Error).

- [ ] **Step 1: Write the failing test**

```typescript
// facebook.media.spec.ts
import { compressImageForFacebook, FACEBOOK_MAX_MEDIA_BYTES } from './facebook.media';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('sharp', () => {
  const instances: any[] = [];
  const sharpMock = jest.fn(() => {
    const chain = {
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn(),
    };
    instances.push(chain);
    return chain;
  });
  (sharpMock as any).instances = instances;
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
    const chain = (sharp as any).instances[0] ?? (sharp as any)();
    // First pass too big, second pass ok
    chain.toBuffer
      .mockResolvedValueOnce(Buffer.alloc(5 * 1024 * 1024))
      .mockResolvedValueOnce(Buffer.alloc(3 * 1024 * 1024));

    const result = await compressImageForFacebook('https://cdn/photo.jpg');
    expect(result.buffer.length).toBeLessThanOrEqual(FACEBOOK_MAX_MEDIA_BYTES);
    expect(result.mime).toBe('image/jpeg');
  });

  it('throws when compression cannot reach the limit', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(1024));
    const chain = (sharp as any).instances.at(-1);
    chain.toBuffer.mockResolvedValue(Buffer.alloc(5 * 1024 * 1024));

    await expect(
      compressImageForFacebook('https://cdn/huge.jpg')
    ).rejects.toThrow(/Could not compress media below Facebook's 4MB limit/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts --no-cache`
Expected: FAIL — module `./facebook.media` not found.

- [ ] **Step 3: Implement minimal image compression**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts --no-cache`
Expected: PASS (adjust mock setup if sharp mock needs fixing — ensure each test gets a fresh chain).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.media.ts \
        libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts
git commit -m "feat(facebook): add image compression helper for 4MB limit"
```

---

### Task 2: Video compression helper

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.media.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts`

**Interfaces:**
- Consumes: `FACEBOOK_MAX_MEDIA_BYTES`, `FacebookMediaCompressionError` from Task 1.
- Produces: `compressVideoForFacebook(mediaUrl: string, uploadFile: (file: Express.Multer.File) => Promise<{ path: string }>): Promise<string>` — returns public URL of compressed MP4.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to facebook.media.spec.ts
import { spawn } from 'child_process';
import { compressVideoForFacebook } from './facebook.media';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { writeFileSync, statSync } from 'fs';

jest.mock('child_process');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

describe('compressVideoForFacebook', () => {
  it('returns a public URL when ffmpeg output is under 4MB', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(100));
    (statSync as jest.Mock).mockReturnValue({ size: 2 * 1024 * 1024 });

    (spawn as unknown as jest.Mock).mockImplementation((cmd: string) => {
      const emitter: any = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn((event, cb) => {
        if (event === 'close') setImmediate(() => cb(0));
      }) };
      if (cmd === 'ffprobe') {
        emitter.stdout.on.mockImplementation((_e: string, cb: (d: string) => void) => cb('10.0'));
      }
      return emitter;
    });

    const uploadFile = jest.fn().mockResolvedValue({ path: 'https://example.com/uploads/compressed.mp4' });
    const url = await compressVideoForFacebook('https://cdn/video.mp4', uploadFile);
    expect(url).toBe('https://example.com/uploads/compressed.mp4');
    expect(uploadFile).toHaveBeenCalled();
  });

  it('throws when ffmpeg is not installed', async () => {
    (readOrFetch as jest.Mock).mockResolvedValue(Buffer.alloc(100));
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const emitter: any = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn((event, cb) => {
        if (event === 'error') setImmediate(() => cb(new Error('ENOENT')));
      }) };
      return emitter;
    });

    await expect(
      compressVideoForFacebook('https://cdn/video.mp4', jest.fn())
    ).rejects.toThrow(/ffmpeg is not installed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts --no-cache`
Expected: FAIL — `compressVideoForFacebook` not exported.

- [ ] **Step 3: Implement video compression**

Add to `facebook.media.ts`:

```typescript
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(require('child_process').execFile);

const VIDEO_WIDTHS = [1280, 854, 640, 480, 360, 320, 240, 180];

async function probeDurationSeconds(inputPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
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
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new FacebookMediaCompressionError(
          'Video compression unavailable — ffmpeg is not installed on this server'
        ));
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
        '-y', '-i', inputPath,
        '-c:v', 'libx264',
        '-b:v', `${bitrateK}k`,
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart',
        '-vf', `scale=${width}:-2`,
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
      try { unlinkSync(p); } catch { /* best-effort */ }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts --no-cache`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.media.ts \
        libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts
git commit -m "feat(facebook): add video compression helper via ffmpeg"
```

---

### Task 3: Wire compression into Facebook provider uploads

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts`

**Interfaces:**
- Consumes: `compressImageForFacebook`, `compressVideoForFacebook`, `FacebookMediaCompressionError` from Task 1–2.
- Produces: private methods `prepareMediaForFacebook(path)`, `uploadPhotoBuffer(pageId, accessToken, buffer, mime, published)`, used by `postPending` / `postNonStory`.

- [ ] **Step 1: Write the failing provider test**

Add to `facebook.provider.spec.ts` (replace the `checkMediaLimits` describe block in Task 5 — for now add a new describe):

```typescript
describe('FacebookProvider - media compression at post time', () => {
  it('prepareMediaForFacebook compresses an oversized image before upload', async () => {
    const compressSpy = jest
      .spyOn(require('./facebook.media'), 'compressImageForFacebook')
      .mockResolvedValue({ buffer: Buffer.alloc(1024), mime: 'image/jpeg' });

    const result = await (provider as any).prepareMediaForFacebook('https://cdn/big.jpg');
    expect(result.kind).toBe('photo');
    expect(result.buffer).toBeDefined();
    compressSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts -t "media compression" --no-cache`
Expected: FAIL — `prepareMediaForFacebook` not defined.

- [ ] **Step 3: Implement provider wiring**

In `facebook.provider.ts`:

1. Add imports:
```typescript
import FormData from 'form-data';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  compressImageForFacebook,
  compressVideoForFacebook,
  FacebookMediaCompressionError,
} from '@gitroom/nestjs-libraries/integrations/social/facebook.media';
```

2. **Remove** `override mediaLimits = { image: { maxSizeBytes: 4 * 1024 * 1024 } };`

3. **Add** override:
```typescript
override async checkMediaLimits(_posts: Array<ValidityMedia[]>): Promise<string | true> {
  return true;
}
```

4. **Add** private helpers:
```typescript
private async prepareMediaForFacebook(path: string): Promise<
  | { kind: 'photo'; buffer: Buffer; mime: 'image/jpeg' | 'image/png' }
  | { kind: 'video'; url: string }
> {
  try {
    if (hasExtension(path, 'mp4')) {
      const storage = UploadFactory.createStorage();
      const url = await compressVideoForFacebook(path, (file) => storage.uploadFile(file));
      return { kind: 'video', url };
    }
    const { buffer, mime } = await compressImageForFacebook(path);
    return { kind: 'photo', buffer, mime };
  } catch (err) {
    if (err instanceof FacebookMediaCompressionError) {
      throw new BadBody(this.identifier, '{}', '{}', err.message);
    }
    throw err;
  }
}

private async uploadPhotoBuffer(
  pageId: string,
  accessToken: string,
  buffer: Buffer,
  mime: string,
  published: boolean,
  label: string
): Promise<{ id: string }> {
  const form = new FormData();
  form.append('source', buffer, {
    filename: mime === 'image/png' ? 'photo.png' : 'photo.jpg',
    contentType: mime,
  });
  form.append('published', published ? 'true' : 'false');
  form.append('access_token', accessToken);

  const response = await this.fetch(
    `https://graph.facebook.com/v20.0/${pageId}/photos`,
    {
      method: 'POST',
      headers: form.getHeaders(),
      body: form as any,
    },
    label
  );
  return response.json();
}
```

5. **Update story loop** in `postPending` (~line 528): replace direct `media.path` usage:
```typescript
for (const media of firstPost?.media || []) {
  const prepared = await this.prepareMediaForFacebook(media.path);
  if (prepared.kind === 'video') {
    // ... existing video_stories start flow, but file_url: prepared.url
  } else {
    const { id: photoId } = await this.uploadPhotoBuffer(
      id, accessToken, prepared.buffer, prepared.mime, false, 'upload photo story'
    );
    items.push({ kind: 'photo', mediaId: photoId });
  }
}
```

6. **Update `postNonStory`** (~line 831): for video branch use `prepared.url`; for photo carousel map with `uploadPhotoBuffer` instead of JSON `{ url: media.path }`.

- [ ] **Step 4: Run provider tests**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --no-cache`
Expected: PASS (except old checkMediaLimits tests — fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts \
        libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts
git commit -m "feat(facebook): compress media at post time before Graph API upload"
```

---

### Task 4: Dockerfile — install ffmpeg

**Files:**
- Modify: `Dockerfile.dev:4-10`

- [ ] **Step 1: Add ffmpeg to apt-get install**

Change:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3-pip \
    bash \
    nginx \
&& rm -rf /var/lib/apt/lists/*
```

To:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3-pip \
    bash \
    nginx \
    ffmpeg \
&& rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile.dev
git commit -m "chore(docker): install ffmpeg for Facebook video compression"
```

---

### Task 5: Update Facebook provider tests (remove old limit tests)

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts`

- [ ] **Step 1: Replace the `proactive 4MB photo limit` describe block**

Remove lines 150–182 (the three `checkMediaLimits` tests).

Add:
```typescript
describe('FacebookProvider - checkMediaLimits bypass (compression at post time)', () => {
  it('always returns true — size enforcement happens during compression', async () => {
    jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(50 * 1024 * 1024);
    const result = await provider.checkMediaLimits([
      [{ path: 'https://cdn/img.png' }],
    ]);
    expect(result).toBe(true);
    expect((provider as any).mediaSize).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --no-cache`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts
git commit -m "test(facebook): update media limit tests for compression flow"
```

---

### Task 6: Frontend informational banner

**Files:**
- Modify: `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/facebook/facebook.provider.tsx`

**Interfaces:**
- Produces: optional `mediaCompressionNote?: string` on `withProvider` params; rendered as info banner when media is attached.

- [ ] **Step 1: Add `mediaCompressionNote` to `withProvider` params**

In `high.order.provider.tsx`, add to the params type (~line 87):
```typescript
mediaCompressionNote?: string;
```

Destructure it alongside `mediaLimits`.

Add helper:
```typescript
export const hasAttachedMedia = (
  entries: Array<{ media?: Array<{ path: string }> }>
): boolean => entries.some((e) => (e.media?.length ?? 0) > 0);
```

In the JSX (~line 292), before the oversized warning block, add:
```typescript
{current && mediaCompressionNote && hasAttachedMedia(value) && (
  <div className="bg-blue-500/10 border border-blue-500 text-blue-400 p-[10px] mb-[18px] rounded-[10px] text-[13px] text-balance">
    {mediaCompressionNote}
  </div>
)}
```

- [ ] **Step 2: Update Facebook frontend provider**

In `facebook.provider.tsx`, remove:
```typescript
mediaLimits: {
  image: { maxSizeBytes: 4 * 1024 * 1024 },
},
```

Add:
```typescript
mediaCompressionNote:
  'Media will be automatically compressed for Facebook (max 4MB, JPG/PNG/MP4 only).',
```

- [ ] **Step 3: Run lint**

Run: `pnpm run lint`
Expected: no new errors in modified files.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/new-launch/providers/high.order.provider.tsx \
        apps/frontend/src/components/new-launch/providers/facebook/facebook.provider.tsx
git commit -m "feat(facebook): show compression info banner in post editor"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run all related tests**

```bash
pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.media.spec.ts --no-cache
pnpm jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --no-cache
pnpm jest libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts --no-cache
```

Expected: all PASS.

- [ ] **Step 2: Run lint**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Manual smoke test (if local env available)**

1. Schedule a Facebook post with an 8MB JPEG from the media library.
2. Confirm the editor shows the blue info banner (not a red size warning).
3. Confirm the post publishes successfully (compressed server-side).
4. Repeat with a short MP4 > 4MB; confirm compression or clear hard-fail message.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Image compression with sharp | Task 1 |
| Video compression with ffmpeg | Task 2 |
| Post-time compression in facebook.provider | Task 3 |
| Multipart photo upload (`source`) | Task 3 |
| Temp video storage URL | Task 2, 3 |
| Hard fail > 4MB | Task 1, 2 |
| Remove mediaLimits / checkMediaLimits bypass | Task 3, 5 |
| GIF → first-frame JPEG | Task 1 (sharp `{ animated: false }`) |
| Dockerfile ffmpeg | Task 4 |
| Frontend mediaCompressionNote | Task 6 |
| No workflow changes | N/A (no task needed) |
| Unit tests | Tasks 1, 2, 5, 7 |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-30-facebook-media-compression.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
