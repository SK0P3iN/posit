# Media size/format limits per provider — design

## Problem

Providers reject media that exceeds their own size/format limits (e.g. Facebook
photos must be ≤ 4MB). Today this is only discovered reactively when the
provider's API rejects the post (Facebook's 4MB photo limit surfaces via Graph
API error code `1366046` in `facebook.provider.ts`'s `handleErrors`). There is
no proactive check, so users only find out a post failed after scheduling.

## Scope (v1)

- Check **file size** and **image-vs-video type** only. No dimension/duration
  checks, no compression/transcoding (no ffmpeg exists in the repo; introducing
  it is a separate, larger effort left for a future iteration).
- Checked in two places:
  - **Server-side, authoritative, hard block**: as part of the existing
    `validatePosts` flow that already runs on `/posts/valid` and on post
    creation. A violation behaves exactly like any other `checkValidity`
    failure today — `PostValidationException`, post is not created/scheduled.
  - **Client-side, advisory only**: an inline warning in the post editor as
    soon as incompatible media is attached to a provider, so the user isn't
    surprised at submit time. This never blocks selection; the server check
    is what actually enforces the limit.
- Limits are added incrementally, per provider, as real numbers are confirmed.
  Providers with no declared limit are unaffected — no behavior change for
  them. First limit to add: Facebook photos, 4MB (turns today's reactive
  Graph API error into a proactive check).

## Non-goals

- Auto-compression or transcoding media that fails a limit.
- Video duration, aspect ratio, or resolution checks.
- Any change to which mime types are accepted at upload time (the existing
  `CustomFileValidationPipe` whitelist is unaffected).

## Design

### Backend (source of truth)

`libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
gains, on `SocialProvider`:

```ts
mediaLimits?: {
  image?: MediaLimit;
  video?: MediaLimit;
};
checkMediaLimits(posts: Array<ValidityMedia[]>): Promise<string | true>;
```

```ts
export type MediaLimit = { maxSizeBytes: number };
```

`SocialAbstract` (`libraries/nestjs-libraries/src/integrations/social.abstract.ts`)
gets:

- `mediaLimits = undefined` default (no limits).
- A default `checkMediaLimits(posts)` implementation: for every media item in
  every post/comment entry, classify image vs video using the existing
  `hasExtension()` helper (video ⇔ `.mp4`, matching the current upload
  whitelist — everything else is treated as image), skip items whose type has
  no declared limit, otherwise call the existing protected `mediaSize()`
  helper (HEAD request for remote URLs / `statSync` for local files — no new
  dependency) and compare against `maxSizeBytes`. Returns a descriptive error
  string (e.g. `"Video exceeds Facebook's 4MB limit (currently 11.2MB)"`) or
  `true`.

Providers only need to override `checkMediaLimits` if their limit logic is
more complex than a flat per-type byte cap (none do for v1). They opt in
purely by setting the `mediaLimits` field, e.g. in `facebook.provider.ts`:

```ts
mediaLimits = { image: { maxSizeBytes: 4 * 1024 * 1024 } };
```

`PostsService.validatePosts`
(`libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`,
around the existing `provider.checkValidity(...)` call at line ~1089) adds a
call to `provider.checkMediaLimits(media)`, combined into the same
valid/invalid result the caller already handles — no change to the
controller (`posts.controller.ts`) or the `PostValidationException` contract.

### Frontend (advisory, live feedback)

Mirrors the existing `maximumCharacters` pattern (a plain per-provider
constant, consumed generically by the shared preview wrapper):

- Each frontend provider file under
  `apps/frontend/src/components/new-launch/providers/<name>/<name>.provider.tsx`
  gets an optional `mediaLimits` constant with the same shape as the backend
  config (kept in sync manually — same duplication already accepted for
  `maximumCharacters`).
- `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx`
  (the generic wrapper every provider preview goes through) gains a check:
  when attached media's `fileSize` exceeds the declared limit for its type,
  render an inline warning banner, using the same visual treatment as the
  existing character-count warning. This is advisory only; it never blocks
  attaching or submitting.

**Prerequisite fix**: `Media.fileSize` exists in the Prisma schema but is
never actually written today (`MediaRepository.saveFile` omits it), so the
frontend has no size value to check against. Fix:
- Upload endpoints (`apps/backend/src/api/routes/media.controller.ts`,
  `/upload-server` and `/upload-simple`, which already compute the real size
  via `CustomFileValidationPipe`) pass the file size through to
  `MediaService.saveFile` → `MediaRepository.saveFile`.
- `fileSize` is added to the `select` clauses / DTOs already returned to the
  frontend by the upload response and the media library list, so existing
  consumers gain the field without a new endpoint.
- Existing rows keep `fileSize: 0` (their default) until re-uploaded — they're
  silently exempt from the live warning; this doesn't affect the backend hard
  block, which measures size live via `mediaSize()` regardless of the stored
  column.

### Error handling

- Client: non-blocking warning banner, same component style as the character
  counter's warning state.
- Server: existing `PostValidationException` path, unchanged shape — just one
  more possible failure message alongside `checkValidity`'s.

### Testing

- Unit tests for `SocialAbstract.checkMediaLimits`: within-limit passthrough,
  over-limit failure message, no-limit-declared passthrough, mixed image/video
  posts.
- `facebook.provider.spec.ts`: assert a >4MB photo fails `checkMediaLimits` and
  surfaces via `validatePosts`.
- Frontend test on `high.order.provider.tsx`'s warning rendering given a
  mocked oversized media item, and confirming it does not block submission
  (server check is the enforcement point).
