# Anonymous Review-Page Comments — Design

## Problem

The public post-review page (`/p/[id]`) already lets anyone view a post and
its existing comments without logging in. Posting a comment, however, is
gated behind a login wall (`CommentsComponents` in
`apps/frontend/src/components/preview/comments.components.tsx`), and the
`Comments` Prisma model requires a `userId`. Reviewers (e.g. clients or
external stakeholders) who don't have a Postiz account currently cannot
leave feedback directly on the review page.

We want any person, with no account, to be able to leave a comment (name +
text) on a review page, and have the org be notified when that happens —
in-app (notification center), via email, and with a visible indicator on
the corresponding post in the calendar.

## Current State (relevant existing code)

- Public preview page: `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx`
- Public GET endpoints (no auth): `apps/backend/src/api/routes/public.controller.ts`
  - `GET /public/posts/:id`
  - `GET /public/posts/:id/comments`
- Authenticated comment creation: `apps/backend/src/api/routes/posts.controller.ts`
  `POST /posts/:id/comments` — requires `@GetOrgFromRequest()` / `@GetUserFromRequest()`.
- Service/repository: `PostsService.createComment` / `PostsRepository` in
  `libraries/nestjs-libraries/src/database/prisma/posts/`.
- Prisma model `Comments` (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`):
  `userId` is required, no name/author field for guests.
- Frontend comment UI: `comments.components.tsx` — blocks non-logged-in
  users with a "Login / Register to add comments" button; comments are
  displayed anonymized as `User1`, `User2`, ... keyed by `userId`.
- Notification system: `NotificationService.inAppNotification(orgId, subject,
  message, sendEmail, digest, type)` in
  `libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts`
  creates an in-app `Notifications` row (org-wide) and optionally emails
  every org member. Existing usage example:
  `IntegrationService.informAboutRefreshError` in
  `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`.
- Notification popup UI (`apps/frontend/src/components/notifications/notification.component.tsx`)
  auto-linkifies raw URLs found in the notification's `content` text
  (`replaceLinks`) — it does not render the separate `link` DB field as a
  clickable link on its own.
- Calendar post cards have no comment-count indicator today. The existing
  `CreationMethodBadge` (`apps/frontend/src/components/launches/creation.method.badge.tsx`)
  is the pattern to imitate for a new badge.

## Decisions

1. **Notification audience**: whole organization (reuse
   `inAppNotification`'s existing org-wide broadcast — no per-user
   targeting).
2. **Anti-abuse**: a hard cap of **3 anonymous comments per post**
   (global, counted across all anonymous comments on that post — not
   per-visitor). Logged-in org members are unaffected by this cap and can
   keep commenting freely. Once the cap is hit, the public form is
   disabled with an explanatory message.
3. **Guest data captured**: name only (required). No email/contact field.
4. **Calendar indicator**: a small comment-count badge on the post card,
   styled like `CreationMethodBadge`, shown when comment count > 0.
5. **Notification plumbing**: reuse `NotificationService.inAppNotification`
   as-is (`sendEmail = true`), matching the `informAboutRefreshError`
   pattern — no new notification mechanism.

## Design

### Schema change (migration required)

In `schema.prisma`, model `Comments`:
- `userId` becomes optional (`String?`), its relation becomes optional.
- Add `authorName String?` — populated only for anonymous comments; `null`
  for comments made by logged-in users.
- A comment is "anonymous" iff `userId IS NULL` (in which case
  `authorName` is set).

This requires a Prisma migration. Existing rows are unaffected (`userId`
stays populated for all current comments); no backfill needed.

### Public write endpoint

Add `POST /public/posts/:id/comments` to `public.controller.ts`, alongside
the existing public `GET` routes — no auth guard, matching the existing
public GET pattern in the same controller.

Request DTO (new, with `class-validator` decorators — closing a gap where
the current authenticated endpoint has no validation at all):
```
{
  name: string    // required, trimmed, max length (e.g. 100)
  content: string // required, trimmed, max length (matches existing comment content limits if any)
}
```

Flow: DTO → Controller → Service → Repository, per project convention.
- Controller resolves `postId` from the route param (no org/user context
  available — this is the public surface, so the service must resolve the
  post's `organizationId` internally from the post record itself, the way
  the existing public GET endpoints already do).
- Service (`PostsService`, new method e.g. `createPublicComment`):
  1. Loads the post to get its `organizationId` (reuse existing lookup
     used by `getComments`/`getPostsRecursively`).
  2. Counts existing comments on the post where `userId IS NULL`
     (repository method, e.g. `countAnonymousComments(postId)`).
  3. If count ≥ 3, throw a 4xx (e.g. `BadRequestException`) with a clear
     message ("This post has reached its review comment limit").
  4. Otherwise inserts the comment via the repository with `userId: null,
     authorName: name, content`.
  5. After successful insert, calls
     `NotificationService.inAppNotification(organizationId, subject,
     message, true, false, 'info')`. The `message` text embeds the
     review-page URL (`/p/:postId`) as plain text so the existing
     `replaceLinks` auto-linkifier turns it into a clickable link in the
     notification popup, mirroring `informAboutRefreshError`.
- Repository: new methods `createPublicComment` (insert with `userId:
  null`) and `countAnonymousComments`, alongside the existing `createComment`/
  `getComments`.

The same notification hook (step 5) should also fire for the existing
authenticated `POST /posts/:id/comments` path, so any comment on a post —
anonymous or logged-in — notifies the org. (Today it doesn't notify at
all.)

### Frontend

`comments.components.tsx`:
- Replace the `!user?.id` branch: instead of rendering only the
  "Login / Register to add comments" button, render a small form with a
  `name` input and a `content` textarea, submitting to the new
  `POST /public/posts/:id/comments` endpoint (via the existing
  `useFetch`/SWR conventions used elsewhere in this component).
- Once the anonymous cap (3) has been reached for the post (surfaced via
  the comments list response or a count returned by the API), disable the
  form and show an explanatory message instead of the input fields.
- Display logic: for a comment where `userId` is null, show `authorName`
  directly as the commenter's label. Logged-in comments keep the current
  `User1`/`User2` anonymization behavior — unchanged.

### Calendar badge

- Add a small comment-count badge to the post card component in the
  calendar view, following the visual/structural pattern of
  `CreationMethodBadge`. Shown when the post's comment count is > 0.
- The count needs to be available on whatever data the calendar already
  loads per post; if not already included, extend the relevant list
  query/response to include a comment count per post (`_count` style
  Prisma aggregation is the natural fit, consistent with "no raw SQL"
  project rule).

### Testing

- Backend:
  - Unit test: 4th anonymous comment on a post is rejected with the
    cap error; 3rd is accepted.
  - Unit test: DTO validation rejects missing/oversized `name`/`content`.
  - Unit test: successful comment creation (public and authenticated
    paths) triggers `NotificationService.inAppNotification` with the
    expected arguments.
- Frontend:
  - Manual verification on `/p/[id]`: anonymous form appears when logged
    out, submits successfully, author name displays correctly, cap
    message appears after 3 anonymous comments.
  - Manual verification: calendar post card shows the comment badge with
    the correct count after comments exist.

## Out of scope

- Editing/deleting anonymous comments.
- Per-visitor rate limiting (cap is a simple global per-post counter, not
  per-IP/session).
- Targeting notifications to a subset of the org (e.g. post owner only) —
  explicitly decided to broadcast org-wide via the existing mechanism.
- Any change to the unrelated, already-dead legacy day-slot comment code
  (`AddCommentDto`, `apps/frontend/src/components/launches/comments/comment.component.tsx`,
  the `comments`/`total` field in `calendar.context.tsx`) — left untouched.
