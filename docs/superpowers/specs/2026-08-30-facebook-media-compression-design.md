# Facebook media compression — design

## Problem

Facebook Graph API rejects photos over 4MB (error `1366046`) and only accepts
JPG/PNG photos and MP4 videos. Today Postiz proactively **blocks** oversized
Facebook photos at schedule time via `checkMediaLimits` and shows an advisory
warning in the editor — but it does not compress media. Users must manually
resize/re-encode files before posting.

We want to **automatically compress and convert** media at Facebook post time
so users can attach any supported upload format and have it fit Facebook's
constraints without manual intervention.

## Scope (v1)

- **Facebook only** — compression runs inside `facebook.provider.ts` at post
  time, not at global upload time.
- **Images**: convert to JPG or PNG and compress to ≤ 4MB using `sharp`
  (already in the repo).
- **Videos**: transcode to MP4 (H.264/AAC) and compress to ≤ 4MB using
  `ffmpeg` (new system dependency).
- **Hard fail** if compression cannot reach ≤ 4MB after iterative attempts.
- Applies to feed posts, photo/video stories, and companion story uploads.
- Original media in the library is never modified.

## Non-goals

- Compression for other providers (LinkedIn, X, etc. keep their existing logic).
- Changing the global upload whitelist (`CustomFileValidationPipe`).
- Dimension, duration, or aspect-ratio validation beyond what compression needs.
- Client-side / browser transcoding.

## Decisions

1. **Post-time, provider-side** (Approach 1): mirrors LinkedIn's
   `prepareMediaBuffer()` pattern. All Facebook-specific logic stays in
   `facebook.provider.ts`.
2. **Hard fail after compression** (user choice A): if the best result is still
   > 4MB, throw `BadBody` with a descriptive message. No best-effort upload.
3. **Remove schedule-time size block for Facebook**: drop `mediaLimits` from
   Facebook provider (backend + frontend). Override `checkMediaLimits` to
   return `true`. Compression at post time is the enforcement point.
4. **ffmpeg via system binary**: install `ffmpeg` in `Dockerfile.dev` via
   `apt-get`. Invoke via `child_process.spawn` (no `fluent-ffmpeg` dependency).
5. **GIF → first-frame JPEG**: animated GIFs are not Facebook-compatible;
   extract first frame with sharp and compress as JPEG.
6. **Temp video storage**: compressed videos are uploaded via
   `UploadFactory.createStorage().uploadFile()` to obtain a public URL for
   Facebook's `file_url` parameter. Temp files are deleted in a `finally`
   block (best-effort).

## Current state (relevant code)

- `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts` —
  uploads photos via `{ url: media.path }` JSON and videos via `{ file_url }`.
  Has `mediaLimits = { image: { maxSizeBytes: 4MB } }` and reactive error
  handling for code `1366046`.
- `libraries/nestjs-libraries/src/integrations/social.abstract.ts` —
  generic `checkMediaLimits()` driven by `mediaLimits` field.
- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` —
  `prepareMediaBuffer()` using sharp (reference pattern).
- `apps/frontend/src/components/new-launch/providers/facebook/facebook.provider.tsx`
  — mirrors backend `mediaLimits` for advisory banner.
- `docs/superpowers/specs/2026-08-29-media-size-limits-design.md` — prior
  design that explicitly deferred compression; this spec supersedes the
  Facebook portion of that design.
- `Dockerfile.dev` — production container build; no ffmpeg today.
- Post execution runs in the orchestrator via `post.activity.ts` calling
  `provider.postPending()` / `provider.post()`.

## Architecture

```
Schedule post
  → validatePosts: Facebook checkMediaLimits returns true (no size block)
  → Frontend shows informational banner (not a blocking warning)

Post workflow (orchestrator)
  → facebook.provider.postPending()
      for each media item:
        prepareMediaForFacebook(path)
          → image: sharp iterative loop → Buffer (jpg/png, ≤4MB)
          → video: ffmpeg iterative loop → temp MP4 → storage URL (≤4MB)
        if result still > 4MB → BadBody (hard fail)
        upload to Graph API:
          → photos: multipart source=buffer (replaces url= JSON upload)
          → videos: file_url=compressedPublicUrl
        cleanup temp files (best-effort finally)
```

## Compression algorithms

### Images (`prepareImageForFacebook`)

1. Fetch bytes via existing `readOrFetch()`.
2. Detect type via `mime-types` `lookup()` on the path.
3. GIF → extract first frame (`sharp`, `{ animated: false }`), output JPEG.
4. PNG/JPEG → preserve format; WebP/BMP/TIFF/AVIF/other → convert to JPEG.
5. Iterative loop (max 10 steps):
   - Initial: quality 85, max dimension 2048px (`fit: 'inside'`,
     `withoutEnlargement: true`).
   - Each step when still > 4MB: reduce quality by 10, then reduce max
     dimension by 20%.
6. Return `{ buffer, mime }`. If still > 4MB after all steps, throw.

### Videos (`prepareVideoForFacebook`)

1. Resolve source to a temp input path (download remote URLs to
   `os.tmpdir()`, or copy local file path).
2. Probe duration via `ffprobe` (spawned alongside ffmpeg).
3. Iterative loop (max 8 steps):
   - Compute target video bitrate: `(TARGET_BYTES * 8 * 0.85) / durationSeconds`.
   - Scale max width: 1280 → 854 → 640 → 480 across iterations.
   - Encode: `ffmpeg -i input -c:v libx264 -b:v {bitrate} -c:a aac -b:a 64k
     -movflags +faststart -vf scale={width}:-2 output.mp4`.
4. Check output size; repeat with lower bitrate/resolution if > 4MB.
5. Upload output via `UploadFactory.createStorage().uploadFile()`.
6. Return public URL. Delete temp input/output in `finally`.

`TARGET_BYTES = 4 * 1024 * 1024`.

## Upload changes

### Photo uploads (feed + story)

Replace JSON `{ url: media.path }` with multipart form upload using the
compressed buffer as `source`:

```
POST /{page-id}/photos
  source: <compressed buffer>
  published: false
  access_token: ...
```

Use `form-data` package (already used by Mastodon, Discord, etc.).

### Video uploads (feed + story)

Replace `file_url: media.path` with `file_url: compressedPublicUrl` from the
temp storage upload.

## Error handling

| Condition | Behavior |
|-----------|----------|
| Compressed file still > 4MB | `BadBody`: "Could not compress media below Facebook's 4MB limit (best result: X.XMB). Try a shorter video or smaller image." |
| Unsupported input format | `BadBody`: "Facebook only accepts JPG/PNG photos and MP4 videos" |
| ffmpeg/ffprobe not on PATH | `BadBody`: "Video compression unavailable — ffmpeg is not installed on this server" |
| Temp storage upload fails | Propagate with context |
| Network error fetching source media | Existing `fetch` / `readOrFetch` error path |

## Frontend changes

- Remove `mediaLimits` from `facebook.provider.tsx`.
- Add an optional `mediaCompressionNote?: string` field to the provider config
  shape in `high.order.provider.tsx` (same pattern as `maximumCharacters`).
  Set it on the Facebook provider:
  `"Media will be automatically compressed for Facebook (max 4MB, JPG/PNG/MP4 only)"`.
  Render it as an informational banner (same component/style as the existing
  media warning) whenever media is attached — no provider-specific branching
  in the generic wrapper.

## Infrastructure

- `Dockerfile.dev`: add `ffmpeg` to the `apt-get install` line.
- Self-hosted installs without Docker must install ffmpeg manually (document
  in error message; no new env var needed for v1).

## Testing

- `facebook.provider.spec.ts`:
  - Image > 4MB compresses to ≤ 4MB (mock sharp / readOrFetch).
  - Video > 4MB compresses to ≤ 4MB (mock ffmpeg spawn).
  - Hard fail when compression cannot reach target.
  - Unsupported format rejection.
  - Remove/update existing `checkMediaLimits` block tests (Facebook no longer
    blocks at validation time).
- `social.abstract.spec.ts`: unchanged (generic helper still tested).
- Manual: post an 8MB JPEG and a 20MB MP4 to a Facebook Page, confirm success.

## Migration / backwards compatibility

- No database migration.
- Existing scheduled posts with oversized media that were previously blocked
  can now be scheduled; they will compress at post time or fail with a clear
  error if compression is insufficient.
- No workflow version change needed — compression happens inside the existing
  provider methods, not in Temporal workflow/activity signatures.
