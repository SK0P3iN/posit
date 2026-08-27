---
title: Public review video playback via SharedVideoPlayer and HTTP Range
date: 2026-08-05
category: integration-issues
module: public review playback
problem_type: integration_issue
component: frontend_stimulus
severity: high
symptoms:
  - Public review link /p/[id] plays mp4 muted with no unmute, play/pause, volume, or scrub controls
  - Seeking fails or stalls for locally stored media because the uploads route does not honor HTTP Range
  - Public stream proxy does not forward Range headers, so scrubbing breaks when media is served through /public/stream
  - Existing VideoOrImage helper is insufficient for review-page playback chrome and is not a drop-in replacement
root_cause: incomplete_setup
resolution_type: code_fix
tags:
  - shared-video-player
  - http-range
  - public-review
  - video-playback
  - local-storage
  - uploads-route
  - public-stream
  - mp4
related_components:
  - tooling
  - service_object
---

# Public review video playback via SharedVideoPlayer and HTTP Range

## Problem

External reviewers opening a public post preview (`/p/{id}`) could not evaluate audio-dependent scheduled videos: playback used a muted-autoplay `<video>` pattern with no unmute, pause, scrub, or volume chrome. Browser autoplay policy requires mute for unattended play, so without controls that mute was a dead end. Success criteria (plan `docs/plans/2026-08-05-001-feat-review-playback-shared-player-plan.md`) required muted autoplay plus YouTube-like chrome and end-to-end audible/seekable playback, including media-serving Range fixes where delivery blocked seek.

## Symptoms

- On the public review page, MP4 media started (or attempted to start) muted with no way for the reviewer to unmute or control playback.
- The shared muted-autoplay helper `VideoOrImage` renders `<video autoPlay muted loop>` with no `controls` attribute and no custom chrome (`libraries/react-shared-libraries/src/helpers/video.or.image.tsx:14-20`).
- Self-hosted local uploads previously returned full-file GETs only; without HTTP Range / 206 Partial Content, browser scrub/seek on long videos could fail or stall on those deployments (addressed in the uploads route as part of this fix).
- Seeking through `/public/stream` could also fail when the proxy did not forward a well-formed client `Range` to upstream (hardening path; public review primarily uses direct `media.path` URLs).

## What Didn't Work

- **Native `<video controls>` as the review UX.** Product settled on YouTube-like custom chrome (unmute chip + bottom bar) over a native-controls minimum (plan KD2). Native controls alone would also not fix missing Range on local uploads.
- **Player chrome only, without serving fixes.** Audible + seekable review requires delivery that honors byte ranges where the storage path needs them (plan R5/R7/KD3). UI unmute cannot make seek work if the server ignores `Range`.
- **Migrating provider compose previews off `VideoOrImage` in the same delivery.** Those call sites use custom layout, fixed heights, sliders, or overlays; they are not KD5 drop-ins. Inventory concluded zero optional drop-ins; `VideoOrImage` remains unchanged for those surfaces (plan KTD4 / KD5).
- **Treating `/public/stream` as the public-review happy path.** Plan KTD5: anonymous review uses direct `media.path` (local `/uploads/...` or CDN). Stream Range-forward is editor/settings hardening, not the primary review media URL.

## Solution

Three coordinated changes in the working tree (implementation present; as of this writing the files are modified/untracked and not necessarily committed; manual smoke of `/p/{id}` was still pending when work paused).

### 1. Shared YouTube-like player

New `SharedVideoPlayer` at `libraries/react-shared-libraries/src/helpers/shared.video.player.tsx`:

- Default muted autoplay via `autoplayMuted` (default `true`); on mount sets `video.muted = true` and calls `play()`, catching rejection into a play-first gesture overlay (`shared.video.player.tsx:33-59`, `169-180`).
- Always-visible bottom control bar: seek scrubber, play/pause, time + buffering/seeking hint (`…`), mute toggle, volume slider (`shared.video.player.tsx:213-263`).
- Unmute chip while muted (`shared.video.player.tsx:201-211`); `toggleMute` / volume path can unmute and restore volume (`shared.video.player.tsx:74-104`).
- Ended → Replay overlay (no loop) (`shared.video.player.tsx:182-199`); load error message (`shared.video.player.tsx:160-167`); buffering/seeking state (`shared.video.player.tsx:141-145`, `111-114`, `241`).

```15:20:libraries/react-shared-libraries/src/helpers/shared.video.player.tsx
export const SharedVideoPlayer: FC<{
  src: string;
  autoplayMuted?: boolean;
  className?: string;
  videoClassName?: string;
}> = ({ src, autoplayMuted = true, className, videoClassName }) => {
```

### 2. Public review page wiring

`apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx` maps each post media entry: MP4 → `SharedVideoPlayer` with `src={media.path}` and `autoplayMuted={true}`; otherwise `SafeImage` (`page.tsx:167-178`). Preview uses the direct media URL, not `/public/stream`.

```167:178:apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx
                            {hasExtension(media.path, 'mp4') ? (
                              <SharedVideoPlayer
                                src={media.path}
                                autoplayMuted={true}
                                videoClassName="object-contain"
                              />
                            ) : (
                              <SafeImage
                                alt="Media image"
                                className="object-contain w-full h-full"
                                src={media.path}
                              />
                            )}
```

`VideoOrImage` is intentionally left as the muted-loop helper for provider compose previews (`video.or.image.tsx:14-20`).

### 3. Media serving: Range / partial content

**Local uploads** (`apps/frontend/src/app/(app)/api/uploads/[[...path]]/route.ts`) — pattern aligned with research from open PR #1784 (local uploads Range; treat as preferred approach, not merged authority until that PR lands):

- Parse `Range` with `/^bytes=(\d+)-(\d*)$/` (`route.ts:44-46`).
- Out-of-bounds → `416` + `Content-Range: bytes */size` (`route.ts:48-56`).
- Partial window → `206`, `Accept-Ranges: bytes`, `Content-Range: bytes start-end/size`, length of window (`route.ts:58-73`).

```42:72:apps/frontend/src/app/(app)/api/uploads/[[...path]]/route.ts
  // Honor ranged requests so browsers can seek video on local storage
  // (and providers that download media in byte windows).
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Number(range[2]) : fileStats.size - 1;
  // ...
  return new Response(webStream, {
    status: range ? 206 : 200,
    headers: {
      // ...
      'Accept-Ranges': 'bytes',
      ...(range
        ? { 'Content-Range': `bytes ${start}-${end}/${fileStats.size}` }
        : {}),
    },
  });
```

**Public stream proxy** (`apps/backend/src/api/routes/public.controller.ts` `/public/stream`) — forward only well-formed `bytes=` Range while keeping SSRF/redirect revalidation:

- Client Range included on upstream `fetch` only when `/^bytes=\d+-\d*$/` matches (`public.controller.ts:185-195`).
- Upstream `Content-Range` / `Accept-Ranges` (default `bytes`) and status `206` passed through (`public.controller.ts:232-241`).

```185:195:apps/backend/src/api/routes/public.controller.ts
      const clientRange = req.headers.range;
      const rangeHeader =
        typeof clientRange === 'string' &&
        /^bytes=\d+-\d*$/.test(clientRange)
          ? clientRange
          : undefined;

      r = await fetch(currentUrl, {
        signal: ac.signal,
        redirect: 'manual',
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
```

## Why This Works

- **Autoplay policy vs reviewability.** Browsers allow muted autoplay; they often block autoplay-with-sound. Starting muted and exposing unmute/volume after load (or play-first if even muted autoplay is blocked) satisfies both the policy and the reviewer’s need to hear audio (`shared.video.player.tsx:49-59`, `201-211`).
- **Controls without fighting provider layouts.** A dedicated player keeps `VideoOrImage`’s mute+loop contract for compose previews while giving the public review surface full chrome where it is the must-ship path (plan KD1/KD5).
- **Seek needs byte ranges.** HTML5 video scrubbing issues ranged GETs. Local uploads now answer with `206`/`Content-Range`/`Accept-Ranges` (`route.ts:61-72`). Direct CDN paths are assumed Range-capable per the plan; stream Range-forward hardens proxied paths without weakening SSRF checks (`public.controller.ts:181-198`, `232-241`).
- **Direct URLs for anonymous review.** Using `media.path` on `/p/[id]` avoids routing seek traffic through the unauthenticated stream proxy for the happy path (plan KTD5 / R7 preference).

## Prevention

- Keep public review MP4 rendering on `SharedVideoPlayer` (or an equivalent controlled player); do not regress to bare `VideoOrImage` on `/p/[id]` without unmute/controls.
- When adding media-serving routes or proxies that feed `<video>`, honor well-formed `Range` (206 + `Content-Range` + `Accept-Ranges`, 416 out of bounds) before claiming seekable playback—mirror the uploads route tests outlined in the plan (U3/U4: curl `Range: bytes=0-9`, assert 206; malformed Range ignored on stream).
- Do not forward arbitrary client headers on `/public/stream`; only the strict `bytes=` pattern (`public.controller.ts:187-188`), and preserve hop-by-hop `isSafePublicHttpsUrl` / redirect limits.
- Treat provider compose `VideoOrImage` migrations as a separate follow-up unless a call site is a true KD5 drop-in (no custom chrome/overlays/layout constraints).
- Before calling the feature done in a release, manually smoke `/p/{id}` with an MP4 that has an audio track: muted start → Unmute → audible play, scrub, pause; on self-hosted media, confirm local uploads Range with curl. As of this session, that smoke was still pending though the implementation is in the working tree.
- Cite and track serving precedent via PR #1784 for local uploads Range rather than relying on ephemeral commit SHAs after rebase/squash.

## Related Issues

- Plan: `docs/plans/2026-08-05-001-feat-review-playback-shared-player-plan.md`
- Adjacent media-domain learning (different problem): `docs/solutions/architecture-patterns/media-library-folders-bulk-delete-trash-purge.md`
- Serving pattern research: PR #1784 (local uploads Range; unmerged as a separate authority as of plan writing—behavior was ported into this tree’s uploads route)
