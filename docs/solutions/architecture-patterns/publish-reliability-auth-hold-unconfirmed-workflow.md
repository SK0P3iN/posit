---
title: Publish reliability — auth hold, unconfirmed publish, and postWorkflowV107
date: 2026-08-05
category: architecture-patterns
module: publish reliability
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - Extending Postiz publish workflows or post outcome states (QUEUE, ERROR, auth-held, unconfirmed)
  - Adding or changing Temporal post publish workflows — create a new versioned workflow instead of mutating an existing one
  - Designing safe Retry / republish behavior after timeouts, crashes, or ambiguous provider responses
  - Handling integration.refreshNeeded or revoked OAuth grants without treating auth breaks as content failures
  - Implementing Instagram or Meta Graph publish with in-flight boundary state and token refresh on error 190
tags:
  - publish-reliability
  - temporal
  - auth-hold
  - unconfirmed-publish
  - post-workflow
  - instagram
  - meta-graph
  - refresh-needed
  - capability-based-refresh
related_components:
  - authentication
  - database
---

# Publish Reliability — Auth-Hold, Unconfirmed Outcomes, and Instagram Publish Boundaries

## Context

Postiz schedules social posts through Temporal workflows that call provider-specific publish activities. On Instagram/Meta and similar channels, two failure modes were causing real user harm:

1. **Token expiry treated as content failure.** When an integration had `refreshNeeded` set (revoked grant, invalid token, refresh failure), the publish workflow marked the post `ERROR` with a generic “Refresh channel needed” message. Users saw a red failure ring on the calendar and were invited to Retry — but the underlying problem was auth, not post content. Retrying without reconnecting could not succeed and trained users to treat reconnect as “try again on bad content.”

2. **Unconfirmed publishes looked like failures.** Instagram’s Graph API creates media containers first, then runs `media_publish` asynchronously. If Postiz timed out or crashed after an irreversible step, the remote post might already be live while Postiz still showed `ERROR`. Blind Retry could duplicate live posts.

A third constraint is architectural: **Temporal workflows already on `origin/main` must never be mutated in place.** Changing activity parameters or workflow logic breaks in-flight executions. Postiz versions workflows (`postWorkflowV106` → `postWorkflowV107`) and points new callers at the latest version while leaving older files untouched.

This learning was implemented as uncommitted work on branch `feat/media-folders-bulk-delete` (alongside media-library changes); as of this writing it is **not** on `origin/main`. Product requirements and sequencing are documented in [`docs/plans/2026-08-05-002-feat-publish-reliability-social-inbox-plan.md`](../../plans/2026-08-05-002-feat-publish-reliability-social-inbox-plan.md).

---

## Guidance

### 1. Auth-hold via `postWorkflowV107` (do not mutate v106)

Create a new workflow version rather than editing `postWorkflowV106`. In `postWorkflowV107`, when `post.integration.refreshNeeded` is true at publish time:

- Send an in-app notification explaining reconnect is required.
- Call `changeState` with **`QUEUE`** (not `ERROR`) and an `AUTH_HOLD:`-prefixed error string for tooltips.
- Return immediately — no irreversible publish mutation runs.

```148:166:apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.7.ts
  // Auth-hold: keep QUEUE (do not mark ERROR) so reconnect can resume without a
  // false content failure. Calendar chrome treats QUEUE + refreshNeeded as held.
  if (post.integration?.refreshNeeded) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please reconnect the channel — scheduled posts stay held until then.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'QUEUE',
      'AUTH_HOLD: Reconnect channel to publish',
      postsListBefore
    );
    return;
  }
```

Contrast with v106, which still marks `ERROR`:

```148:165:apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.6.ts
  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Refresh channel needed',
      postsListBefore
    );
    return;
  }
```

**Point all new workflow starts at v107** (on this feature branch; `origin/main` still starts `postWorkflowV106` until merge). `posts.service` starts `postWorkflowV107` when scheduling posts, and `post.activity` signals missing-post sweeps with the same name:

```788:790:libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('postWorkflowV107', {
```

```80:80:apps/orchestrator/src/activities/post.activity.ts
        .workflow.signalWithStart('postWorkflowV107', {
```

Repeat-post child workflows inside v107 also call `postWorkflowV107` (line 678 of v107).

### 2. Unconfirmed outcomes: `UNCONFIRMED:` sentinel + blocked republish

When the workflow cannot confirm whether a remote publish completed (timeout after mutation, token refresh failure mid-poll, exhausted status checks), it writes `ERROR` with a **`UNCONFIRMED:`** prefix — not a generic failure that invites Retry:

```274:300:apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.7.ts
  const markUnconfirmed = async (err: any) => {
    const detail = formatPublishError(
      err,
      'Could not confirm the post status'
    );
    const message = detail.startsWith('UNCONFIRMED:')
      ? detail
      : `UNCONFIRMED: ${detail}`;
    await changeState(postsList[0].id, 'ERROR', message, postsList);
    await inAppNotification(
      post.organizationId,
      `We couldn't confirm your post on ${capitalize(
        post.integration?.providerIdentifier
      )}`,
      `Your post was sent to ${capitalize(
        post.integration?.providerIdentifier
      )}, but we couldn't confirm it was published. Please check your ${
        post?.integration?.name
      } account before posting again to avoid duplicates.`,
      true,
      false,
      'fail'
    );
  };
```

**Server-side republish guard:** `assertCanRepublish` rejects schedule/now (and schedule-status) paths when a post is `ERROR` with `UNCONFIRMED:`. Draft `update` paths intentionally skip this guard:

```128:142:libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
  private async assertCanRepublish(orgId: string, postIds: string[]) {
    for (const id of postIds) {
      if (!id) {
        continue;
      }
      const existing = await this._postRepository.getPostById(id, orgId);
      if (
        existing?.state === 'ERROR' &&
        String(existing.error || '').startsWith('UNCONFIRMED:')
      ) {
        throw new BadRequestException(
          'This post is unconfirmed. Confirm it was published on the channel, or mark it as already live, before posting again.'
        );
      }
    }
  }
```

**Safe resolution without republish:** `POST /posts/:id/confirm-published` transitions unconfirmed posts to `PUBLISHED`:

```67:73:apps/backend/src/api/routes/posts.controller.ts
  @Post('/:id/confirm-published')
  async confirmAlreadyLive(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.confirmAlreadyLive(org.id, id);
  }
```

```102:125:libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
  async confirmAlreadyLive(orgId: string, id: string) {
    const post = await this._postRepository.getPostById(id, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }
    if (
      post.state !== 'ERROR' ||
      !String(post.error || '').startsWith('UNCONFIRMED:')
    ) {
      throw new BadRequestException(
        'Only unconfirmed posts can be marked as already published'
      );
    }

    const updated = await this._postRepository.confirmAlreadyLive(id, orgId);
    // ...
    await this.clearPostInFlight(id);

    return { id, state: 'PUBLISHED' as const };
  }
```

**Manage modal:** blocks Schedule and Post Now when `unconfirmedError` is set; offers “Mark as published” CTA:

```218:232:apps/frontend/src/components/new-launch/manage.modal.tsx
  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (
        unconfirmedError &&
        (type === 'now' || type === 'schedule')
      ) {
        toaster.show(
          t(
            'unconfirmed_block_retry',
            'This post may already be live. Confirm it on the channel, then mark it as already published — do not republish.'
          ),
          'warning'
        );
        return;
      }
```

Schedule/Post Now buttons are disabled when `!!unconfirmedError` (lines 747, 787 of the same file).

### 3. Plain-string errors for `bad_body` (not ActivityFailure JSON)

Providers throw `BadBody` / `RefreshToken` as Temporal `ApplicationFailure` subclasses (`social.abstract.ts` lines 42–68). The workflow extracts the human message via `formatPublishError`, preferring `ApplicationFailure.message` over serialized ActivityFailure JSON:

```250:272:apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.7.ts
  const formatPublishError = (err: unknown, fallback: string) => {
    if (typeof err === 'string' && err.trim()) {
      return err.trim();
    }
    if (
      err instanceof ActivityFailure &&
      err.cause instanceof ApplicationFailure &&
      err.cause.message
    ) {
      return err.cause.message;
    }
    // ...
    return fallback;
  };
```

For `bad_body`, the stored `post.error` is `handle.message` (the provider string), not the full Temporal wrapper (storage at lines 523–533 of v107; in-app notification follows separately).

### 4. Instagram publish boundary: Redis `post:inflight:{id}` + pending/finalize split

**Mutation activities get no automatic retries** (`maximumAttempts: 1`) so a timed-out attempt cannot silently double-publish:

```45:56:apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.7.ts
const proxyMutationTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 1,
    },
  });
};
```

**After container creation**, Instagram `postPending` calls a progress callback with `status: 'in-progress'` and JSON `pendingData` as `postId`. `post.activity` stores this in Redis:

```290:307:apps/orchestrator/src/activities/post.activity.ts
    const progress = async (response: {
      id: string;
      postId: string;
      releaseURL: string;
      status: string;
    }) => {
      if (response.status === 'in-progress') {
        await this._postService.setPostInFlight(response.id, response.postId);
        return;
      }

      await this._postService.updatePost(
        response.id,
        response.postId,
        response.releaseURL
      );
      await this._postService.clearPostInFlight(response.id);
    };
```

```88:91:libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
  async setPostInFlight(id: string, inFlightId: string) {
    await ioRedis.set(`post:inflight:${id}`, inFlightId, 'EX', 2 * 60 * 60);
  }
```

**On retry**, `postSocialInternal` reads Redis and passes `inFlight` to the provider; Instagram `postPending` resumes existing containers instead of creating new ones:

```260:262:apps/orchestrator/src/activities/post.activity.ts
      inFlight =
        (await this._postService.getPostInFlight(firstPost.id)) || undefined;
```

```678:694:libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts
    if (firstPost?.inFlight) {
      try {
        const pendingData = JSON.parse(firstPost.inFlight);
        return [
          {
            id: firstPost.id,
            postId: '',
            releaseURL: '',
            status: 'pending',
            pendingData: {
              ...pendingData,
              postDbId: firstPost.id,
            },
          },
        ];
      } catch {
        // Corrupt marker — fall through to a fresh create
      }
    }
```

**Workflow polling:** `resolvePending` calls read-only `checkPostStatus` (retries allowed), then `finalizePost` (no retries). `checkPostStatus` / `finalizePost` activities persist completed publishes via `updatePost` at the activity boundary:

```362:370:apps/orchestrator/src/activities/post.activity.ts
    const postDbId = pendingData?.postDbId as string | undefined;
    if (postDbId && result.status === 'completed') {
      await this._postService.updatePost(
        postDbId,
        result.postId,
        result.releaseURL
      );
      await this._postService.clearPostInFlight(postDbId);
    }
```

**Never demote after publish:** once `posted = true`, the outer catch calls `markUnconfirmed` instead of retrying the publish (lines 486–502 of v107). Timeouts on mutation activities also route to `markUnconfirmed` (lines 511–519).

### 5. Meta/Instagram auth recovery (U4)

- **Graph code 190 → refresh-token path:** Instagram `handleErrors` maps OAuth error code 190 to `refresh-token`, which the workflow handles via `refreshTokenWithCause`:

```325:330:libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts
    if (/"code":\s*190\b/.test(body)) {
      return {
        type: 'refresh-token' as const,
        value:
          'The Instagram access token is invalid, please reconnect the channel',
      };
    }
```

- **Filter pages without `access_token`:** Instagram `pages()` skips pages the user never granted to the app, avoiding broken `undefined___...` tokens:

```558:569:libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts
            // Pages without an access_token were never granted to the app
            // in the OAuth dialog — selecting them would store a broken
            // "undefined___..." token
            const { access_token } = await (
              await fetch(
                `https://graph.facebook.com/v20.0/${p.id}?fields=access_token&access_token=${accessToken}`
              )
            ).json();

            if (!access_token) {
              return null;
            }
```

- **OAuth `auth_type=rerequest`:** reconnect re-prompts declined permissions:

```427:429:libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts
        // Re-prompt permissions/assets the user previously declined, so a
        // bad page grant can be repaired by reconnecting
        `&auth_type=rerequest` +
```

- **Clear `refreshNeeded` on reconnect:** integration upsert sets `refreshNeeded: false`:

```184:194:libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts
    return this._integration.model.integration.update({
      where: {
        ...(existing ? { id: existing.id } : { id }),
      },
      data: {
        ...params,
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      },
    });
```

### 6. Calendar chrome: amber for auth-held and unconfirmed; red for content errors

```1019:1073:apps/frontend/src/components/launches/calendar.tsx
  const isUnconfirmed =
    state === 'ERROR' &&
    typeof post.error === 'string' &&
    post.error.startsWith('UNCONFIRMED:');
  const isAuthHeld =
    state === 'QUEUE' &&
    !!post.integration?.refreshNeeded &&
    isBeforeNow;
  const isContentError = state === 'ERROR' && !isUnconfirmed;
  // ...
        isContentError && 'rounded-[10px] ring-2 ring-red-500',
        isUnconfirmed && 'rounded-[10px] ring-2 ring-amber-400',
        isAuthHeld && 'rounded-[10px] ring-2 ring-amber-500',
```

Tooltips strip the `AUTH_HOLD:` / `UNCONFIRMED:` prefixes for display (lines 1028–1045).

---

## Why This Matters

- **Duplicate posts are worse than delayed posts.** A live Instagram post that Postiz marks as failed invites Retry; the fix must block republish until the user confirms or the system reconciles.
- **Auth failures are not content failures.** Treating `refreshNeeded` as `ERROR` misleads users and hides the real fix (reconnect). Auth-hold keeps posts in `QUEUE` so they resume after reconnect without a manual “retry on error.”
- **Temporal versioning is non-negotiable in production.** Mutating `postWorkflowV106` would break running executions. New behavior is introduced as `postWorkflowV107` on this branch (callers updated locally); v106 remains for historical runs and for `origin/main` until this work merges.
- **Irreversible mutations need publish boundaries.** Splitting Instagram into `postPending` → `checkPostStatus` → `finalizePost`, with Redis resume markers and mutation activities at `maximumAttempts: 1`, prevents container re-creation and double `media_publish`.

---

## When to Apply

Apply this pattern when:

1. **Adding publish reliability fixes** to any channel where an irreversible API step can succeed remotely while Postiz loses confirmation (timeouts, worker crashes, token expiry mid-flight).
2. **Handling broken auth before publish** — if `refreshNeeded` or equivalent is set, hold the schedule instead of marking content failure.
3. **Shipping workflow behavior changes** — always copy to a new version (`postWorkflowV1.0.x`), update callers, leave prior versions untouched per `CLAUDE.md`.
4. **Meta/Instagram OAuth reconnect flows** — use `auth_type=rerequest`, filter ungranted pages, map code 190 to reconnect/refresh paths.
5. **Surfacing post state in calendar/UI** — distinguish auth-held (`QUEUE` + past-due + `refreshNeeded`), unconfirmed (`ERROR` + `UNCONFIRMED:`), and genuine content errors (`ERROR` without prefix).

Do **not** apply blindly when a channel has no pending/finalize split and publishes atomically — the Redis in-flight marker and three-phase workflow are most valuable where providers expose async processing (Instagram containers, similar patterns on Threads, etc.).

---

## Examples

### Example A — Scheduled post hits expired Instagram token

1. Background refresh or publish detects invalid token → `refreshNeeded: true` on integration.
2. Due post enters `postWorkflowV107`.
3. Workflow hits auth-hold branch → post stays `QUEUE`, error `AUTH_HOLD: Reconnect channel to publish`, notification sent.
4. Calendar shows **amber ring** (auth-held), not red.
5. User reconnects via OAuth (`auth_type=rerequest`) → `refreshNeeded` cleared.
6. Missing-post sweep or next schedule tick re-enters workflow → publish proceeds normally.

### Example B — Timeout after `media_publish` started

1. `postSocialPending` creates containers → Redis stores JSON pendingData (`post:inflight:{id}`).
2. `finalizePost` starts `media_publish` but activity times out (`maximumAttempts: 1`, no auto-retry).
3. Workflow calls `markUnconfirmed` → `ERROR` with `UNCONFIRMED: …` prefix.
4. Calendar shows **amber ring**; manage modal disables Schedule/Post Now.
5. User verifies post is live on Instagram → clicks “Mark as published” → `POST /posts/:id/confirm-published` → `PUBLISHED`, Redis marker cleared.
6. If user had tried Retry first, `assertCanRepublish` would reject with guidance to confirm first.

### Example C — Platform rejects content (`bad_body`)

1. Instagram returns aspect-ratio error → provider throws `BadBody` with human message.
2. Workflow `handleActivityError` classifies as `bad-body`.
3. `changeState(..., 'ERROR', handle.message)` stores plain string like “Aspect ratio not supported…” — not ActivityFailure JSON.
4. Calendar shows **red ring** (`isContentError`).

---

## Related

- **Plan:** [`docs/plans/2026-08-05-002-feat-publish-reliability-social-inbox-plan.md`](../../plans/2026-08-05-002-feat-publish-reliability-social-inbox-plan.md) — requirements R1–R9 (confirmation, errors, auth-hold), KTD1–KTD3, unit U1–U4.
- **Workflows:** `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.7.ts` (current); `post.workflow.v1.0.6.ts` (frozen predecessor).
- **Activities:** `apps/orchestrator/src/activities/post.activity.ts` — `postSocialPending`, `checkPostStatus`, `finalizePost`, workflow start/signal names.
- **Provider:** `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts` — `postPending`, `checkPostStatus`, `finalizePost`, OAuth, page filtering.
- **Failure types:** `libraries/nestjs-libraries/src/integrations/social.abstract.ts` — `RefreshToken`, `BadBody` ApplicationFailure subclasses.
- **Post service:** `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` — in-flight Redis, `confirmAlreadyLive`, `assertCanRepublish`.
- **UI:** `apps/frontend/src/components/launches/calendar.tsx`, `apps/frontend/src/components/new-launch/manage.modal.tsx`.
- **Repo rule:** `CLAUDE.md` — “Workflows files can never be changed if they are already in origin/main — create a new workflow with the version.”
