# Inbox: Comment Likes and Full Thread View

## Problem

The Social Inbox (`CONCEPTS.md` "Social Inbox" / "Inbox Item") currently
shows engagement as a flat list of top-level comments, mentions, and DMs.
Each row can be read and replied to, but:

- There is no way to like/react to a comment from Postiz.
- There is no way to see a post's full comment thread (top-level comments
  plus their nested replies) in one place — only the flat, un-nested list
  of up to 20 top-level comments per post that the background sync fetches.

This spec adds both: liking a comment (pushed to the real platform, not a
local-only marker) and a per-post thread view showing all comments and
replies, with the ability to like or reply to any node in the thread.

## Provider capability reality (verified during brainstorming)

Only some platforms expose a public API for liking a comment:

- **Facebook**: `POST /{comment-id}/likes` (and `DELETE` to unlike) has
  existed for years.
- **Instagram**: Meta added an official like/unlike endpoint for comments,
  replies, and posts in April 2026, gated behind the
  `instagram_manage_engagement` permission. It only works for Instagram
  Business/Creator accounts connected via Facebook Business login (not a
  standalone Instagram login) — the same connection type Postiz already
  requires for Instagram Graph API access today.
- **YouTube**: the Data API v3 has no endpoint for liking a comment
  (`comments.setModerationStatus` only covers moderation, not reactions).
  Not supported, full stop.
- **X**: the Inbox integration only supports mentions today
  (`comments: false` in `inboxCapabilities()`), so there is no comment
  thread to like in the first place.

Scope for this feature: **Facebook and Instagram**, capability-gated the
same way the Inbox already gates `comments`/`mentions`/`dms` per provider.
YouTube and X simply don't implement the new provider methods, so the UI
never shows the affordance for their items.

## Architecture

Both new capabilities are **live, on-demand calls** to the provider API —
nothing is persisted. Rationale:

- The full thread (comments + nested replies) can be large and provider
  APIs are rate-limited; fetching it only when a user actually opens a
  post avoids wasted calls for posts nobody reviews.
- Like state can be requested directly from the provider alongside each
  comment (Facebook/Instagram return `like_count` and `user_likes` on a
  comment when asked), so Postiz never needs to store or reconcile like
  state itself.
- This means **no Prisma migration is needed**. The existing `InboxItem`
  table and `inbox.sync.workflow.ts` background sync are untouched — they
  keep handling only the flat top-level list for the main Inbox view.

The new thread view is a separate, parallel read path: it fetches directly
from the provider each time it's opened, keyed by the post's remote id
(already available today as `InboxItem.threadKey`, which Facebook/Instagram
already set to `String(post.id)` when syncing top-level comments).

## Provider interface changes

`libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`:

```ts
export type InboxCapabilities = {
  comments: boolean;
  mentions: boolean;
  dms: boolean;
  embeddable: boolean;
  likes: boolean; // new — defaults to false in the abstract base class
};

export type InboxThreadNode = {
  remoteId: string;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  remoteCreatedAt?: string | Date | null;
  replyCapable: boolean;
  likeCapable: boolean;
  likeCount: number;
  likedByMe: boolean;
  replies: InboxThreadNode[];
};
```

New optional methods on the provider interface:

```ts
fetchInboxThread?(
  accessToken: string,
  postRemoteId: string,
  integration: Integration
): Promise<InboxThreadNode[]>;

likeInboxComment?(
  accessToken: string,
  commentRemoteId: string,
  liked: boolean,
  integration: Integration
): Promise<{ liked: boolean; likeCount: number }>;
```

`InboxThreadNode.replies` is recursive so nested replies fit naturally
without a special-cased shape, even though in practice Facebook/Instagram
only nest one level deep.

### Facebook (`facebook.provider.ts`)

- `inboxCapabilities()` gains `likes: true`.
- `fetchInboxThread`: `GET /{postRemoteId}?fields=comments.limit(50){id,message,from,created_time,like_count,user_likes,comments.limit(50){id,message,from,created_time,like_count,user_likes}}`, mapped into `InboxThreadNode[]`.
- `likeInboxComment`: `POST /{commentRemoteId}/likes` when `liked === true`, `DELETE /{commentRemoteId}/likes` when `liked === false`.

### Instagram (`instagram.provider.ts`)

- `inboxCapabilities()` gains `likes: true`.
- `fetchInboxThread`: same shape via the Instagram Graph API comment
  fields for a media object.
- `likeInboxComment`: uses the new April 2026 like/unlike comment
  endpoint. No extra account-type check is needed beyond what Postiz
  already requires to use the Instagram Graph API at all.

### YouTube / X

No changes. `inboxCapabilities().likes` stays `false` (default in
`social.abstract.ts`), and `fetchInboxThread`/`likeInboxComment` are left
unimplemented, so the UI hides both the like button and the "view thread"
affordance for their items.

## Backend endpoints

Added to `apps/backend/src/api/routes/inbox.controller.ts`, following the
existing DTO → Controller → Service → Repository convention (no
repository/DB step here since nothing is persisted — this mirrors how
`/inbox/capabilities` is already a thin passthrough):

- `GET /inbox/thread/:integrationId/:postRemoteId` — params validated via
  a DTO. `InboxService.getThread(organizationId, integrationId,
  postRemoteId)` loads the `Integration`, resolves its access token
  (reusing the existing token-retrieval helper used by
  `fetchInboxItems`/`replyToInboxItem`), checks
  `inboxCapabilities().comments`, then calls the provider's
  `fetchInboxThread`. Returns `InboxThreadNode[]`.
- `POST /inbox/comment/:integrationId/:commentRemoteId/like` — body
  `{ liked: boolean }` via DTO. Checks `inboxCapabilities().likes`, calls
  the provider's `likeInboxComment`, returns `{ liked, likeCount }`.
- `POST /inbox/comment/:integrationId/:commentRemoteId/reply` — body
  `{ message: string }` via DTO. Calls the provider's existing
  `replyToInboxItem` directly with the given remote id (no provider
  change needed — it already only requires a remoteId). This is a
  sibling to the existing `POST /inbox/:id/reply`, needed because thread
  nodes are not persisted `InboxItem` rows and so have no local `:id` to
  address.

All three routes are capability-gated using the same
`inboxCapabilities()` data already exposed via `GET /inbox/capabilities`,
so the frontend can decide what to render without a failed request
round-trip.

## Frontend

New component `apps/frontend/src/components/inbox/thread/post-thread.modal.tsx`:

- Triggered by a new "View full thread" button on a selected Inbox item
  whose provider capability has `comments: true`, placed next to the
  existing embed panel in `inbox.component.tsx`.
- A modal (matching existing modal patterns under
  `apps/frontend/src/components/ui`) that fetches
  `GET /inbox/thread/:integrationId/:postRemoteId` via a dedicated SWR
  hook (`use.inbox.thread.hook.ts` — one hook per rules-of-hooks
  convention), keyed on `[integrationId, postRemoteId]`.
- Renders the recursive `InboxThreadNode[]` tree: each node shows author,
  body, timestamp, a like button (using the existing icon set, filled/
  active state from `likedByMe`, count from `likeCount`) when
  `likeCapable`, and a "Reply" toggle revealing an inline textarea when
  `replyCapable`. Replies are indented one level per depth.
- Liking calls `POST /inbox/comment/:integrationId/:commentRemoteId/like`
  optimistically — flip the icon state immediately, roll back via SWR
  `mutate` on error, matching whatever optimistic-update pattern the
  existing Inbox read/unread toggle already uses.
- Replying calls
  `POST /inbox/comment/:integrationId/:commentRemoteId/reply`, then
  re-fetches the thread (SWR `mutate`) to show the new reply appended
  under the right node.
- Nodes belonging to a provider without the `likes` capability simply
  omit the like button entirely (hidden, not disabled).

## Testing

- Backend: unit tests for `InboxService.getThread` and the new like/reply
  passthrough methods, mocking the provider's `fetchInboxThread` /
  `likeInboxComment`. Capability-gating tests (403/empty result when the
  provider lacks the capability).
- Provider: unit tests for Facebook's and Instagram's `fetchInboxThread`
  (nested comment mapping) and `likeInboxComment` (correct HTTP
  method/endpoint for like vs. unlike), mocking `fetch`.
- Frontend: component test for `post-thread.modal.tsx` covering the
  nested render, optimistic like toggle and rollback-on-error, and reply
  submission triggering a re-fetch.
- Manual verification: exercise the modal against a real Facebook Page
  and a real Instagram Business account with an existing multi-reply
  comment thread, confirming likes actually appear on the platform.

## Out of scope

- YouTube and X comment liking (not supported by their public APIs /
  no comment support at all).
- Persisting thread nodes or like state in the database.
- Extending the background `inbox.sync.workflow.ts` to sync nested
  replies — the thread view is fetched live only when opened.
