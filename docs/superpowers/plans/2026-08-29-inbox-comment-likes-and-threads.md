# Inbox Comment Likes and Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user like a comment (pushed to the real platform) and open a post's full comment thread — top-level comments plus nested replies — from the Inbox, with the ability to like or reply to any node in that thread.

**Architecture:** Everything is a live, on-demand call to the provider's API — nothing is persisted. Opening a thread calls a new `fetchInboxThread` provider method; liking calls a new `likeInboxComment` provider method. Both are implemented only for Facebook and Instagram (the only two providers with a public like-a-comment API); YouTube and X keep the abstract base class's defaults, which is how the UI ends up hiding the affordance for them. No Prisma migration, no changes to the background `inbox.sync.workflow.ts`.

**Tech Stack:** NestJS (backend/orchestrator), Vite + React (frontend), SWR, class-validator DTOs, Jest.

**Spec:** `docs/superpowers/specs/2026-08-29-inbox-comment-likes-and-threads-design.md`

## Global Constraints

- Real platform likes only — no local-only reaction fallback for unsupported providers (spec: "Provider capability reality").
- Scope is Facebook + Instagram only; YouTube and X get no new provider methods.
- No Prisma schema changes. No changes to `inbox.sync.workflow.ts` or `inbox.activity.ts`.
- Thread view and likes are fetched live on open/click — never cached in the database.
- Follow the existing DTO → Controller → Service → Repository convention; these new routes have no repository step since nothing is persisted (same shape as the existing `/inbox/capabilities` passthrough).
- Provider code must stay generic: no `if (providerIdentifier === 'facebook')` branching in shared code (`inbox.service.ts`, `inbox.controller.ts`, frontend). All platform-specific behavior lives inside `facebook.provider.ts` / `instagram.provider.ts` behind the provider interface.

---

### Task 1: Provider interface types + `SocialAbstract` defaults

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social.abstract.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts`

**Interfaces:**
- Produces: `InboxCapabilities` gains a `likes: boolean` field. New exported type `InboxThreadNode`. New optional methods on `SocialProvider`: `fetchInboxThread?(accessToken: string, postRemoteId: string, integration: Integration): Promise<InboxThreadNode[]>` and `likeInboxComment?(accessToken: string, commentRemoteId: string, liked: boolean, integration: Integration): Promise<{ liked: boolean; likeCount: number }>`. `SocialAbstract` provides concrete defaults for both, exactly mirroring how it already defaults `fetchInboxItems`/`replyToInboxItem`.

- [ ] **Step 1: Add `likes` to `InboxCapabilities` and add the `InboxThreadNode` type**

In `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`, find:

```ts
export type InboxCapabilities = {
  comments: boolean;
  mentions: boolean;
  dms: boolean;
  embeddable: boolean;
};
```

Replace with:

```ts
export type InboxCapabilities = {
  comments: boolean;
  mentions: boolean;
  dms: boolean;
  embeddable: boolean;
  likes: boolean;
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

- [ ] **Step 2: Add the two new optional methods to the `SocialProvider` interface**

In the same file, immediately after the existing `replyToInboxItem?(...)` member (just before `deriveCompanionPosts?`), add:

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

- [ ] **Step 3: Write the failing tests for `SocialAbstract`'s new defaults**

In `libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts`, add a new `describe` block after the existing `SocialAbstract.checkMediaLimits` block:

```ts
describe('SocialAbstract - inbox likes/thread defaults', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  it('inboxCapabilities() defaults likes to false', () => {
    expect(provider.inboxCapabilities().likes).toBe(false);
  });

  it('fetchInboxThread defaults to an empty array', async () => {
    const result = await provider.fetchInboxThread(
      'token',
      'post-1',
      {} as any
    );
    expect(result).toEqual([]);
  });

  it('likeInboxComment throws for a provider that has not implemented it', async () => {
    await expect(
      provider.likeInboxComment('token', 'comment-1', true, {} as any)
    ).rejects.toThrow('Inbox comment likes are not supported for this channel');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx jest social.abstract.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: FAIL — `provider.inboxCapabilities().likes` is `undefined`, and `fetchInboxThread`/`likeInboxComment` are not functions on `TestProvider`.

- [ ] **Step 5: Implement the defaults in `SocialAbstract`**

In `libraries/nestjs-libraries/src/integrations/social.abstract.ts`, update the import block to also pull in `InboxThreadNode`:

```ts
import {
  CompanionDerivationContext,
  CompanionDerivationResult,
  FetchedInboxItem,
  InboxCapabilities,
  InboxReplyTarget,
  InboxThreadNode,
  PendingCheckResponse,
  MediaLimit,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
```

Then replace the existing `inboxCapabilities()` default and add the two new default methods right after `replyToInboxItem`:

```ts
  public inboxCapabilities(): InboxCapabilities {
    return {
      comments: false,
      mentions: false,
      dms: false,
      embeddable: false,
      likes: false,
    };
  }

  public async fetchInboxItems(
    _accessToken: string,
    _integration: Integration
  ): Promise<FetchedInboxItem[]> {
    return [];
  }

  public async replyToInboxItem(
    _accessToken: string,
    _item: InboxReplyTarget,
    _message: string,
    _integration: Integration
  ): Promise<{ remoteId: string }> {
    throw new BadBody(
      this.identifier,
      '{}',
      '{}',
      'Inbox replies are not supported for this channel'
    );
  }

  public async fetchInboxThread(
    _accessToken: string,
    _postRemoteId: string,
    _integration: Integration
  ): Promise<InboxThreadNode[]> {
    return [];
  }

  public async likeInboxComment(
    _accessToken: string,
    _commentRemoteId: string,
    _liked: boolean,
    _integration: Integration
  ): Promise<{ liked: boolean; likeCount: number }> {
    throw new BadBody(
      this.identifier,
      '{}',
      '{}',
      'Inbox comment likes are not supported for this channel'
    );
  }
```

(Only `inboxCapabilities`, `fetchInboxThread`, and `likeInboxComment` are new/changed — `fetchInboxItems` and `replyToInboxItem` are shown above only for placement context; leave them as they already are.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest social.abstract.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts \
        libraries/nestjs-libraries/src/integrations/social.abstract.ts \
        libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts
git commit -m "feat(inbox): add likeInboxComment/fetchInboxThread to the provider interface"
```

---

### Task 2: Facebook provider — thread fetch and comment likes

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts:980-1032`
- Test: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts`

**Interfaces:**
- Consumes: `InboxThreadNode` from Task 1. `this.fetch(url, options)` inherited from `SocialAbstract` (returns a `Response`; throws after 2 retries on non-2xx).
- Produces: `FacebookProvider.inboxCapabilities()` now includes `likes: true`. `FacebookProvider.fetchInboxThread(accessToken, postRemoteId, integration)` and `FacebookProvider.likeInboxComment(accessToken, commentRemoteId, liked, integration)`, matching the interface from Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts` (new `describe` block, using the same inline `jsonResponse` helper style as `instagram.provider.spec.ts`):

```ts
const jsonResponse = (body: any, status = 200) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

describe('FacebookProvider - inbox comment likes and threads', () => {
  let provider: FacebookProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new FacebookProvider();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inboxCapabilities() reports likes: true', () => {
    expect(provider.inboxCapabilities().likes).toBe(true);
  });

  it('fetchInboxThread maps nested replies into InboxThreadNode.replies', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        comments: {
          data: [
            {
              id: 'c1',
              message: 'top comment',
              from: { id: 'u1', name: 'Alice' },
              created_time: '2026-08-01T00:00:00Z',
              like_count: 2,
              user_likes: true,
              comments: {
                data: [
                  {
                    id: 'c1-r1',
                    message: 'a reply',
                    from: { id: 'u2', name: 'Bob' },
                    created_time: '2026-08-01T01:00:00Z',
                    like_count: 0,
                    user_likes: false,
                  },
                ],
              },
            },
          ],
        },
      })
    );

    const result = await provider.fetchInboxThread(
      'token-123',
      'post-1',
      {} as any
    );

    expect(result).toEqual([
      {
        remoteId: 'c1',
        authorName: 'Alice',
        authorId: 'u1',
        authorPicture: null,
        body: 'top comment',
        remoteCreatedAt: '2026-08-01T00:00:00Z',
        replyCapable: true,
        likeCapable: true,
        likeCount: 2,
        likedByMe: true,
        replies: [
          {
            remoteId: 'c1-r1',
            authorName: 'Bob',
            authorId: 'u2',
            authorPicture: null,
            body: 'a reply',
            remoteCreatedAt: '2026-08-01T01:00:00Z',
            replyCapable: true,
            likeCapable: true,
            likeCount: 0,
            likedByMe: false,
            replies: [],
          },
        ],
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain(
      'https://graph.facebook.com/v20.0/post-1'
    );
    expect(fetchMock.mock.calls[0][0]).toContain('access_token=token-123');
  });

  it('likeInboxComment(liked: true) POSTs to /likes and returns the refreshed state', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ like_count: 3, user_likes: true }));

    const result = await provider.likeInboxComment(
      'token-123',
      'comment-1',
      true,
      {} as any
    );

    expect(result).toEqual({ liked: true, likeCount: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://graph.facebook.com/v20.0/comment-1/likes?access_token=token-123'
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('likeInboxComment(liked: false) DELETEs /likes and returns the refreshed state', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ like_count: 1, user_likes: false }));

    const result = await provider.likeInboxComment(
      'token-123',
      'comment-1',
      false,
      {} as any
    );

    expect(result).toEqual({ liked: false, likeCount: 1 });
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest facebook.provider.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: FAIL — `provider.fetchInboxThread`/`provider.likeInboxComment` don't exist as overrides yet (they resolve to `SocialAbstract`'s defaults, which return `[]` / throw), and `inboxCapabilities().likes` is `undefined`.

- [ ] **Step 3: Implement in `FacebookProvider`**

In `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts`, change the existing `inboxCapabilities()` override:

```ts
  override inboxCapabilities() {
    return {
      comments: true,
      mentions: false,
      dms: false,
      embeddable: true,
      likes: true,
    };
  }
```

Then, immediately after the existing `replyToInboxItem` override (after its closing `}` around line 1032), add:

```ts
  override async fetchInboxThread(
    accessToken: string,
    postRemoteId: string,
    _integration: Integration
  ): Promise<InboxThreadNode[]> {
    const post = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${postRemoteId}?fields=comments.limit(50){id,message,from,created_time,like_count,user_likes,comments.limit(50){id,message,from,created_time,like_count,user_likes}}&access_token=${accessToken}`
      )
    ).json();

    const mapComment = (comment: any): InboxThreadNode => ({
      remoteId: String(comment.id),
      authorName: comment.from?.name || null,
      authorId: comment.from?.id || null,
      authorPicture: null,
      body: comment.message || '',
      remoteCreatedAt: comment.created_time || null,
      replyCapable: true,
      likeCapable: true,
      likeCount: comment.like_count || 0,
      likedByMe: !!comment.user_likes,
      replies: (comment.comments?.data || []).map(mapComment),
    });

    return (post?.comments?.data || []).map(mapComment);
  }

  override async likeInboxComment(
    accessToken: string,
    commentRemoteId: string,
    liked: boolean
  ): Promise<{ liked: boolean; likeCount: number }> {
    await this.fetch(
      `https://graph.facebook.com/v20.0/${commentRemoteId}/likes?access_token=${accessToken}`,
      { method: liked ? 'POST' : 'DELETE' }
    );

    const detail = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${commentRemoteId}?fields=like_count,user_likes&access_token=${accessToken}`
      )
    ).json();

    return { liked: !!detail.user_likes, likeCount: detail.like_count || 0 };
  }
```

Add `InboxThreadNode` to this file's existing import from `social.integrations.interface` (find the import line that already brings in types like `FetchedInboxItem` or similar for this file — if the file has no such import yet, add a new one: `import { InboxThreadNode } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest facebook.provider.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts \
        libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts
git commit -m "feat(inbox): implement fetchInboxThread and likeInboxComment for Facebook"
```

---

### Task 3: Instagram provider — thread fetch and comment likes

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts:1157-1213`
- Test: `libraries/nestjs-libraries/src/integrations/social/instagram.provider.spec.ts`

**Interfaces:**
- Consumes: `InboxThreadNode` from Task 1. `GRAPH_API_VERSION` (already exported from this file). `this.fetch`.
- Produces: `InstagramProvider.inboxCapabilities()` now includes `likes: true`. `InstagramProvider.fetchInboxThread` / `InstagramProvider.likeInboxComment`, same signatures as Task 1's interface.

**Known limitation to carry into the implementation:** Meta's Instagram Graph API like/unlike endpoint (added April 2026) has no documented field for reading back "did the connected account already like this comment" on a comment fetch. So `fetchInboxThread` always returns `likedByMe: false` for Instagram nodes — the thread view won't show a comment as pre-liked on reopen even if it was liked earlier. `likeInboxComment` itself still works and its response reflects the just-performed action accurately (the frontend's optimistic-then-confirmed state is correct within a session).

- [ ] **Step 1: Write the failing tests**

Add to `libraries/nestjs-libraries/src/integrations/social/instagram.provider.spec.ts` (new `describe` block, reusing the file's existing `jsonResponse` helper):

```ts
describe('InstagramProvider - inbox comment likes and threads', () => {
  let provider: InstagramProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new InstagramProvider();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inboxCapabilities() reports likes: true', () => {
    expect(provider.inboxCapabilities().likes).toBe(true);
  });

  it('fetchInboxThread maps nested replies, always with likedByMe: false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        comments: {
          data: [
            {
              id: 'ig-c1',
              text: 'top comment',
              username: 'alice',
              from: { id: 'u1' },
              timestamp: '2026-08-01T00:00:00Z',
              like_count: 5,
              replies: {
                data: [
                  {
                    id: 'ig-c1-r1',
                    text: 'a reply',
                    username: 'bob',
                    from: { id: 'u2' },
                    timestamp: '2026-08-01T01:00:00Z',
                    like_count: 0,
                  },
                ],
              },
            },
          ],
        },
      })
    );

    const result = await provider.fetchInboxThread(
      'token-123___page-1',
      'media-1',
      {} as any
    );

    expect(result).toEqual([
      {
        remoteId: 'ig-c1',
        authorName: 'alice',
        authorId: 'u1',
        authorPicture: null,
        body: 'top comment',
        remoteCreatedAt: '2026-08-01T00:00:00Z',
        replyCapable: true,
        likeCapable: true,
        likeCount: 5,
        likedByMe: false,
        replies: [
          {
            remoteId: 'ig-c1-r1',
            authorName: 'bob',
            authorId: 'u2',
            authorPicture: null,
            body: 'a reply',
            remoteCreatedAt: '2026-08-01T01:00:00Z',
            replyCapable: true,
            likeCapable: true,
            likeCount: 0,
            likedByMe: false,
            replies: [],
          },
        ],
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain('access_token=token-123');
    expect(fetchMock.mock.calls[0][0]).not.toContain('page-1');
  });

  it('likeInboxComment(liked: true) POSTs to /likes using the split access token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await provider.likeInboxComment(
      'token-123___page-1',
      'ig-c1',
      true,
      {} as any
    );

    expect(result).toEqual({ liked: true, likeCount: 0 });
    expect(fetchMock.mock.calls[0][0]).toContain('ig-c1/likes');
    expect(fetchMock.mock.calls[0][0]).toContain('access_token=token-123');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('likeInboxComment(liked: false) DELETEs /likes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await provider.likeInboxComment(
      'token-123___page-1',
      'ig-c1',
      false,
      {} as any
    );

    expect(result).toEqual({ liked: false, likeCount: 0 });
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest instagram.provider.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: FAIL

- [ ] **Step 3: Implement in `InstagramProvider`**

In `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`, change the existing `inboxCapabilities()` override:

```ts
  override inboxCapabilities() {
    return {
      comments: true,
      mentions: false,
      dms: false,
      embeddable: true,
      likes: true,
    };
  }
```

Then, immediately after the existing `replyToInboxItem` override, add:

```ts
  override async fetchInboxThread(
    token: string,
    postRemoteId: string,
    _integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<InboxThreadNode[]> {
    const [accessToken] = token.split('___');
    const media = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${postRemoteId}?fields=comments.limit(50){id,text,username,from,timestamp,like_count,replies.limit(50){id,text,username,from,timestamp,like_count}}&access_token=${accessToken}`
      )
    ).json();

    const mapComment = (comment: any): InboxThreadNode => ({
      remoteId: String(comment.id),
      authorName: comment.username || comment.from?.username || null,
      authorId: comment.from?.id || null,
      authorPicture: null,
      body: comment.text || '',
      remoteCreatedAt: comment.timestamp || null,
      replyCapable: true,
      likeCapable: true,
      likeCount: comment.like_count || 0,
      // Instagram's Graph API does not expose a "liked by me" read field for
      // comments (see the plan's "Known limitation" note) — always false.
      likedByMe: false,
      replies: (comment.replies?.data || []).map(mapComment),
    });

    return (media?.comments?.data || []).map(mapComment);
  }

  override async likeInboxComment(
    token: string,
    commentRemoteId: string,
    liked: boolean,
    _integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<{ liked: boolean; likeCount: number }> {
    const [accessToken] = token.split('___');
    await this.fetch(
      `https://${type}/${GRAPH_API_VERSION}/${commentRemoteId}/likes?access_token=${accessToken}`,
      { method: liked ? 'POST' : 'DELETE' }
    );
    return { liked, likeCount: 0 };
  }
```

Add `InboxThreadNode` to this file's existing import from `social.integrations.interface` (the file already imports other types from that module around the top of the file — add `InboxThreadNode` to that same import list).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest instagram.provider.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts \
        libraries/nestjs-libraries/src/integrations/social/instagram.provider.spec.ts
git commit -m "feat(inbox): implement fetchInboxThread and likeInboxComment for Instagram"
```

---

### Task 4: `LikeInboxCommentDto`

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/inbox/like.inbox.comment.dto.ts`

**Interfaces:**
- Produces: `LikeInboxCommentDto` with a single validated `liked: boolean` field, for the new like route's request body.

No test file for this task — it's a pure DTO with no logic, validated indirectly through the controller/service tests in Task 5 and 6, matching how `ReplyInboxDto` has no dedicated spec of its own.

- [ ] **Step 1: Create the DTO**

```ts
import { IsBoolean } from 'class-validator';

export class LikeInboxCommentDto {
  @IsBoolean()
  liked: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add libraries/nestjs-libraries/src/dtos/inbox/like.inbox.comment.dto.ts
git commit -m "feat(inbox): add LikeInboxCommentDto"
```

---

### Task 5: `InboxService` — `getThread`, `likeComment`, `replyToComment`

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.ts`
- Test: `libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.spec.ts`

**Interfaces:**
- Consumes: `IntegrationService.getIntegrationById(orgId, integrationId): Promise<Integration | null>` (already used by `reply()`). `IntegrationManager.getSocialIntegration(providerIdentifier): SocialProvider`. `RefreshToken` (already imported in this file). `provider.fetchInboxThread` / `provider.likeInboxComment` / `provider.replyToInboxItem` / `provider.inboxCapabilities()` from Tasks 1-3.
- Produces: `InboxService.getThread(orgId, integrationId, postRemoteId): Promise<InboxThreadNode[]>`, `InboxService.likeComment(orgId, integrationId, commentRemoteId, liked): Promise<{ liked: boolean; likeCount: number }>`, `InboxService.replyToComment(orgId, integrationId, commentRemoteId, message): Promise<{ replyRemoteId: string | null }>` — these are what Task 6's controller calls.

- [ ] **Step 1: Write the failing tests**

Add to `libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.spec.ts`, reusing the existing `makeInboxService` helper. Add a new `describe` block:

```ts
describe('InboxService - comment thread, like, and remote-id reply', () => {
  describe('getThread', () => {
    it('throws NotFoundException when the integration does not belong to the org', async () => {
      const { service, integrationService } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        service.getThread('org-1', 'integration-1', 'post-1')
      ).rejects.toThrow('Channel not found');
    });

    it('throws BadRequestException when the provider does not support comments', async () => {
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'integration-1',
            token: 'token',
            refreshNeeded: false,
            disabled: false,
            providerIdentifier: 'youtube',
          }),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: false,
              mentions: false,
              dms: false,
              embeddable: false,
              likes: false,
            }),
          }),
        },
      });

      await expect(
        service.getThread('org-1', 'integration-1', 'post-1')
      ).rejects.toThrow('This channel does not support inbox comments');
    });

    it('delegates to provider.fetchInboxThread and returns its result', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const threadNodes = [{ remoteId: 'c1', replies: [] }];
      const fetchInboxThread = jest.fn().mockResolvedValue(threadNodes);
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            fetchInboxThread,
          }),
        },
      });

      const result = await service.getThread('org-1', 'integration-1', 'post-1');

      expect(result).toBe(threadNodes);
      expect(fetchInboxThread).toHaveBeenCalledWith('token', 'post-1', integration);
    });
  });

  describe('likeComment', () => {
    it('throws BadRequestException when the provider does not support likes', async () => {
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'integration-1',
            token: 'token',
            refreshNeeded: false,
            disabled: false,
            providerIdentifier: 'youtube',
          }),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: false,
            }),
          }),
        },
      });

      await expect(
        service.likeComment('org-1', 'integration-1', 'comment-1', true)
      ).rejects.toThrow('This channel does not support liking inbox comments');
    });

    it('delegates to provider.likeInboxComment and returns its result', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const likeInboxComment = jest
        .fn()
        .mockResolvedValue({ liked: true, likeCount: 4 });
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            likeInboxComment,
          }),
        },
      });

      const result = await service.likeComment(
        'org-1',
        'integration-1',
        'comment-1',
        true
      );

      expect(result).toEqual({ liked: true, likeCount: 4 });
      expect(likeInboxComment).toHaveBeenCalledWith(
        'token',
        'comment-1',
        true,
        integration
      );
    });
  });

  describe('replyToComment', () => {
    it('throws BadRequestException for a blank message', async () => {
      const { service } = makeInboxService();
      await expect(
        service.replyToComment('org-1', 'integration-1', 'comment-1', '   ')
      ).rejects.toThrow('Reply message is required');
    });

    it('delegates to provider.replyToInboxItem with a COMMENT target built from the remote id', async () => {
      const integration = {
        id: 'integration-1',
        token: 'token',
        refreshNeeded: false,
        disabled: false,
        providerIdentifier: 'facebook',
      };
      const replyToInboxItem = jest
        .fn()
        .mockResolvedValue({ remoteId: 'new-reply-1' });
      const { service } = makeInboxService({
        integrationService: {
          getIntegrationById: jest.fn().mockResolvedValue(integration),
        },
        integrationManager: {
          getSocialIntegration: jest.fn().mockReturnValue({
            inboxCapabilities: () => ({
              comments: true,
              mentions: false,
              dms: false,
              embeddable: true,
              likes: true,
            }),
            replyToInboxItem,
          }),
        },
      });

      const result = await service.replyToComment(
        'org-1',
        'integration-1',
        'comment-1',
        '  hello  '
      );

      expect(result).toEqual({ replyRemoteId: 'new-reply-1' });
      expect(replyToInboxItem).toHaveBeenCalledWith(
        'token',
        { type: 'COMMENT', remoteId: 'comment-1' },
        'hello',
        integration
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest inbox.service.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: FAIL — `service.getThread`/`likeComment`/`replyToComment` don't exist yet.

- [ ] **Step 3: Implement the three methods**

In `libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.ts`, add these three methods to the `InboxService` class (after the existing `reply` method, before the closing `}`):

```ts
  async getThread(orgId: string, integrationId: string, postRemoteId: string) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.refreshNeeded || integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before viewing inbox threads'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().comments) {
      throw new BadRequestException(
        'This channel does not support inbox comments'
      );
    }

    try {
      return await provider.fetchInboxThread(
        integration.token,
        postRemoteId,
        integration
      );
    } catch (err) {
      if (err instanceof RefreshToken) {
        await this._integrationService.disconnectChannel(orgId, integration);
        throw new BadRequestException(
          'Reconnect the channel before viewing inbox threads'
        );
      }
      throw err;
    }
  }

  async likeComment(
    orgId: string,
    integrationId: string,
    commentRemoteId: string,
    liked: boolean
  ) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.refreshNeeded || integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before liking inbox comments'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().likes) {
      throw new BadRequestException(
        'This channel does not support liking inbox comments'
      );
    }

    try {
      return await provider.likeInboxComment(
        integration.token,
        commentRemoteId,
        liked,
        integration
      );
    } catch (err) {
      if (err instanceof RefreshToken) {
        await this._integrationService.disconnectChannel(orgId, integration);
        throw new BadRequestException(
          'Reconnect the channel before liking inbox comments'
        );
      }
      throw err;
    }
  }

  async replyToComment(
    orgId: string,
    integrationId: string,
    commentRemoteId: string,
    message: string
  ) {
    const trimmed = (message || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Reply message is required');
    }

    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.refreshNeeded || integration.disabled) {
      throw new BadRequestException(
        'Reconnect the channel before replying to inbox items'
      );
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxCapabilities().comments) {
      throw new BadRequestException(
        'This channel does not support inbox replies'
      );
    }

    try {
      const result = await provider.replyToInboxItem(
        integration.token,
        { type: 'COMMENT', remoteId: commentRemoteId },
        trimmed,
        integration
      );
      return { replyRemoteId: result?.remoteId || null };
    } catch (err) {
      if (err instanceof RefreshToken) {
        await this._integrationService.disconnectChannel(orgId, integration);
        throw new BadRequestException(
          'Reconnect the channel before replying to inbox items'
        );
      }
      throw err;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest inbox.service.spec.ts --config libraries/nestjs-libraries/jest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.ts \
        libraries/nestjs-libraries/src/database/prisma/inbox/inbox.service.spec.ts
git commit -m "feat(inbox): add getThread/likeComment/replyToComment to InboxService"
```

---

### Task 6: `InboxController` — new routes

**Files:**
- Modify: `apps/backend/src/api/routes/inbox.controller.ts`

**Interfaces:**
- Consumes: `InboxService.getThread`/`likeComment`/`replyToComment` from Task 5. `LikeInboxCommentDto` from Task 4. Existing `ReplyInboxDto`.
- Produces: `GET /inbox/thread/:integrationId/:postRemoteId`, `POST /inbox/comment/:integrationId/:commentRemoteId/like`, `POST /inbox/comment/:integrationId/:commentRemoteId/reply`.

No new backend test file for this task — NestJS controllers here are thin one-line delegations (see the existing routes), and the service-level behavior is already covered by Task 5's tests; this matches how `reply()`/`markRead()` have no dedicated controller-level test either. Verified manually in Task 9.

- [ ] **Step 1: Add the new routes**

In `apps/backend/src/api/routes/inbox.controller.ts`, add the import:

```ts
import { LikeInboxCommentDto } from '@gitroom/nestjs-libraries/dtos/inbox/like.inbox.comment.dto';
```

Then add these three routes to the `InboxController` class, after the existing `reply` route and before `delete`:

```ts
  @Get('/thread/:integrationId/:postRemoteId')
  getThread(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('postRemoteId') postRemoteId: string
  ) {
    return this._inboxService.getThread(org.id, integrationId, postRemoteId);
  }

  @Post('/comment/:integrationId/:commentRemoteId/like')
  likeComment(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('commentRemoteId') commentRemoteId: string,
    @Body() body: LikeInboxCommentDto
  ) {
    return this._inboxService.likeComment(
      org.id,
      integrationId,
      commentRemoteId,
      body.liked
    );
  }

  @Post('/comment/:integrationId/:commentRemoteId/reply')
  replyToComment(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('commentRemoteId') commentRemoteId: string,
    @Body() body: ReplyInboxDto
  ) {
    return this._inboxService.replyToComment(
      org.id,
      integrationId,
      commentRemoteId,
      body.message
    );
  }
```

- [ ] **Step 2: Type-check the backend app**

Run: `pnpm run --filter backend type-check` (or, if that script doesn't exist, `cd apps/backend && npx tsc --noEmit -p tsconfig.app.json`)
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/api/routes/inbox.controller.ts
git commit -m "feat(inbox): add thread/like/comment-reply routes"
```

---

### Task 7: Frontend — `useInboxThread` hook

**Files:**
- Create: `apps/frontend/src/components/inbox/thread/use.inbox.thread.hooks.ts`

**Interfaces:**
- Consumes: `useFetch` from `@gitroom/helpers/utils/custom.fetch`.
- Produces: `InboxThreadNode` type (frontend mirror of the backend type). `useInboxThread(integrationId, postRemoteId)` — a single-purpose SWR hook, per the project's rules-of-hooks convention (`CLAUDE.md`: one SWR call per hook).

No dedicated test for this file alone — it's a thin `useSWR` wrapper exercised for real (not mocked) by Task 8's component test, exactly like `useInboxList` is exercised for real in `inbox.component.test.tsx`.

- [ ] **Step 1: Create the hook**

```ts
'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type InboxThreadNode = {
  remoteId: string;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  remoteCreatedAt?: string | null;
  replyCapable: boolean;
  likeCapable: boolean;
  likeCount: number;
  likedByMe: boolean;
  replies: InboxThreadNode[];
};

export const useInboxThread = (
  integrationId: string | undefined,
  postRemoteId: string | undefined
) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (
      await fetch(
        `/inbox/thread/${integrationId}/${encodeURIComponent(
          postRemoteId as string
        )}`
      )
    ).json() as Promise<InboxThreadNode[]>;
  }, [fetch, integrationId, postRemoteId]);

  return useSWR(
    integrationId && postRemoteId
      ? `inbox-thread-${integrationId}-${postRemoteId}`
      : null,
    load
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/inbox/thread/use.inbox.thread.hooks.ts
git commit -m "feat(inbox): add useInboxThread hook"
```

---

### Task 8: Frontend — thread node renderer and modal

**Files:**
- Create: `apps/frontend/src/components/inbox/thread/thread-comment-node.component.tsx`
- Create: `apps/frontend/src/components/inbox/thread/post-thread.modal.tsx`
- Test: `apps/frontend/src/components/inbox/thread/thread-comment-node.component.test.tsx`

**Interfaces:**
- Consumes: `InboxThreadNode`, `useInboxThread` from Task 7. `useFetch`, `useT`, `useToaster`, `Button` (all existing, same imports as `inbox.component.tsx`). `LoadingComponent` from `@gitroom/frontend/components/layout/loading`.
- Produces: `ThreadCommentNode` (recursive renderer, one comment/reply node + its children). `PostThreadModal` (fetches the thread and renders the top-level `ThreadCommentNode` list) — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/inbox/thread/thread-comment-node.component.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThreadCommentNode } from '@gitroom/frontend/components/inbox/thread/thread-comment-node.component';
import type { InboxThreadNode } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const mockToasterShow = jest.fn();
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const makeNode = (overrides: Partial<InboxThreadNode> = {}): InboxThreadNode => ({
  remoteId: 'c1',
  authorName: 'Alice',
  body: 'top comment',
  replyCapable: true,
  likeCapable: true,
  likeCount: 2,
  likedByMe: false,
  replies: [],
  ...overrides,
});

beforeEach(() => {
  mockFetch.mockReset();
  mockToasterShow.mockReset();
});

it('renders the comment body, nested replies, and the like count', () => {
  const node = makeNode({
    replies: [makeNode({ remoteId: 'c1-r1', authorName: 'Bob', body: 'a reply' })],
  });

  render(
    <ThreadCommentNode
      node={node}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  expect(screen.getByText('top comment')).toBeInTheDocument();
  expect(screen.getByText('a reply')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

it('clicking like calls the like endpoint and updates the count/state from the response', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ liked: true, likeCount: 3 }),
  });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  fireEvent.click(screen.getByText('2'));

  await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  expect(mockFetch).toHaveBeenCalledWith(
    '/inbox/comment/integration-1/c1/like',
    { method: 'POST', body: JSON.stringify({ liked: true }) }
  );
});

it('shows a toast and leaves the count unchanged when the like request fails', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ message: 'nope' }),
  });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  fireEvent.click(screen.getByText('2'));

  await waitFor(() => expect(mockToasterShow).toHaveBeenCalledWith('nope', 'warning'));
  expect(screen.getByText('2')).toBeInTheDocument();
});

it('opening reply, typing, and sending calls the reply endpoint and clears the box', async () => {
  const onChanged = jest.fn();
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={onChanged}
    />
  );

  fireEvent.click(screen.getByText('Reply'));
  fireEvent.change(screen.getByPlaceholderText('Write a reply...'), {
    target: { value: 'my reply' },
  });
  fireEvent.click(screen.getByText('Send reply'));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(mockFetch).toHaveBeenCalledWith('/inbox/comment/integration-1/c1/reply', {
    method: 'POST',
    body: JSON.stringify({ message: 'my reply' }),
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest thread-comment-node.component.test.tsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `ThreadCommentNode`**

Create `apps/frontend/src/components/inbox/thread/thread-comment-node.component.tsx`:

```tsx
'use client';

import { FC, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import type { InboxThreadNode } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';

export const ThreadCommentNode: FC<{
  node: InboxThreadNode;
  integrationId: string;
  depth: number;
  onChanged: () => void;
}> = ({ node, integrationId, depth, onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [liking, setLiking] = useState(false);
  const [likedByMe, setLikedByMe] = useState(node.likedByMe);
  const [likeCount, setLikeCount] = useState(node.likeCount);
  const [replying, setReplying] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const toggleLike = async () => {
    setLiking(true);
    try {
      const nextLiked = !likedByMe;
      const response = await fetch(
        `/inbox/comment/${integrationId}/${node.remoteId}/like`,
        { method: 'POST', body: JSON.stringify({ liked: nextLiked }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toaster.show(
          err?.message || t('inbox_like_failed', 'Could not update like'),
          'warning'
        );
        return;
      }
      const result = await response.json();
      setLikedByMe(result.liked);
      setLikeCount(result.likeCount);
    } catch {
      toaster.show(t('inbox_like_failed', 'Could not update like'), 'warning');
    } finally {
      setLiking(false);
    }
  };

  const sendReply = async () => {
    if (!replyText.trim()) {
      return;
    }
    setReplying(true);
    try {
      const response = await fetch(
        `/inbox/comment/${integrationId}/${node.remoteId}/reply`,
        { method: 'POST', body: JSON.stringify({ message: replyText.trim() }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toaster.show(
          err?.message || t('inbox_reply_failed', 'Reply failed'),
          'warning'
        );
        return;
      }
      setReplyText('');
      setReplyOpen(false);
      toaster.show(t('inbox_reply_sent', 'Reply sent'));
      onChanged();
    } catch {
      toaster.show(t('inbox_reply_failed', 'Reply failed'), 'warning');
    } finally {
      setReplying(false);
    }
  };

  return (
    <div
      style={{ marginLeft: depth * 24 }}
      className="flex flex-col gap-[6px] py-[8px] border-b border-newBorder"
    >
      <div className="flex items-start gap-[8px]">
        {node.authorPicture ? (
          <img
            src={node.authorPicture}
            alt=""
            className="w-[28px] h-[28px] rounded-full"
          />
        ) : (
          <div className="w-[28px] h-[28px] rounded-full bg-seventh" />
        )}
        <div className="flex-1">
          <div className="text-[13px] font-[600]">
            {node.authorName || t('unknown_author', 'Unknown')}
            {node.remoteCreatedAt && (
              <span className="ml-[8px] text-[11px] opacity-60 font-normal">
                {dayjs(node.remoteCreatedAt).format('MMM D, YYYY HH:mm')}
              </span>
            )}
          </div>
          <div className="text-[14px] whitespace-pre-wrap">{node.body}</div>
          <div className="flex items-center gap-[12px] mt-[4px]">
            {node.likeCapable && (
              <button
                type="button"
                disabled={liking}
                onClick={toggleLike}
                className={clsx(
                  'text-[12px] flex items-center gap-[4px]',
                  likedByMe ? 'text-red-400' : 'opacity-70'
                )}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={likedByMe ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
                </svg>
                {likeCount}
              </button>
            )}
            {node.replyCapable && (
              <button
                type="button"
                className="text-[12px] opacity-70"
                onClick={() => setReplyOpen((open) => !open)}
              >
                {t('reply', 'Reply')}
              </button>
            )}
          </div>
          {replyOpen && (
            <div className="flex flex-col gap-[6px] mt-[6px]">
              <textarea
                className="w-full min-h-[60px] rounded-[8px] bg-newBgColor border border-newBorder p-[8px] text-[13px]"
                placeholder={t('write_a_reply', 'Write a reply...')}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  loading={replying}
                  disabled={!replyText.trim()}
                  onClick={sendReply}
                >
                  {t('send_reply', 'Send reply')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {node.replies.map((child) => (
        <ThreadCommentNode
          key={child.remoteId}
          node={child}
          integrationId={integrationId}
          depth={depth + 1}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest thread-comment-node.component.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement `PostThreadModal`**

Create `apps/frontend/src/components/inbox/thread/post-thread.modal.tsx`:

```tsx
'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useInboxThread } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';
import { ThreadCommentNode } from '@gitroom/frontend/components/inbox/thread/thread-comment-node.component';

export const PostThreadModal: FC<{
  integrationId: string;
  postRemoteId: string;
}> = ({ integrationId, postRemoteId }) => {
  const t = useT();
  const { data, isLoading, mutate } = useInboxThread(integrationId, postRemoteId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[40px]">
        <LoadingComponent />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center text-textColor py-[20px] text-[14px]">
        {t('inbox_thread_empty', 'No comments yet on this post.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[70vh] overflow-y-auto">
      {data.map((node) => (
        <ThreadCommentNode
          key={node.remoteId}
          node={node}
          integrationId={integrationId}
          depth={0}
          onChanged={() => mutate()}
        />
      ))}
    </div>
  );
};
```

This has no dedicated test of its own — it is a thin `useInboxThread` + `ThreadCommentNode` composition, both already covered (Task 7's hook is exercised for real, `ThreadCommentNode` is unit-tested above). Manual verification happens in Task 9.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/inbox/thread/thread-comment-node.component.tsx \
        apps/frontend/src/components/inbox/thread/thread-comment-node.component.test.tsx \
        apps/frontend/src/components/inbox/thread/post-thread.modal.tsx
git commit -m "feat(inbox): add post thread modal with like and reply per comment node"
```

---

### Task 9: Wire "View full thread" into the Inbox detail pane

**Files:**
- Modify: `apps/frontend/src/components/inbox/inbox.component.tsx:1-19,80-93,357-393`
- Modify: `apps/frontend/src/components/inbox/use.inbox.hooks.ts:68-78` (extend `InboxChannelCapabilities` with `likes`)

**Interfaces:**
- Consumes: `PostThreadModal` from Task 8. `useModals` from `@gitroom/frontend/components/layout/new-modal` (already used elsewhere, e.g. `missing-release.modal.tsx`).
- Produces: a "View full thread" button in the existing detail pane, shown only when the selected item's provider supports `comments` and the item has a `threadKey` (the post's remote id).

- [ ] **Step 1: Extend `InboxChannelCapabilities`**

In `apps/frontend/src/components/inbox/use.inbox.hooks.ts`, update the type:

```ts
export type InboxChannelCapabilities = {
  integrationId: string;
  name: string;
  providerIdentifier: string;
  refreshNeeded: boolean;
  comments: boolean;
  mentions: boolean;
  dms: boolean;
  embeddable: boolean;
  likes: boolean;
  supported: boolean;
};
```

(This is a type-only change — the backend already returns `likes` as of Task 1/5's `capabilitiesForProvider`/`listChannelCapabilities`, which spread whatever `inboxCapabilities()` returns.)

- [ ] **Step 2: Add the button and modal wiring**

In `apps/frontend/src/components/inbox/inbox.component.tsx`, add these imports alongside the existing ones:

```ts
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { PostThreadModal } from '@gitroom/frontend/components/inbox/thread/post-thread.modal';
```

Add `const modal = useModals();` next to the other hooks near the top of `InboxComponent` (after `const toaster = useToaster();`).

In the JSX, find this block (the author/embed row):

```tsx
                {canEmbed && EmbedComponent ? (
                  <EmbedComponent key={selectedItem.id} item={selectedItem} />
                ) : (
                  <OpenLink remoteUrl={selectedItem.remoteUrl} />
                )}
```

Replace it with:

```tsx
                {canEmbed && EmbedComponent ? (
                  <EmbedComponent key={selectedItem.id} item={selectedItem} />
                ) : (
                  <OpenLink remoteUrl={selectedItem.remoteUrl} />
                )}
                {selectedCapability?.comments && selectedItem.threadKey && (
                  <Button
                    onClick={() =>
                      modal.openModal({
                        title: t('inbox_view_thread', 'View full thread'),
                        closeOnClickOutside: true,
                        closeOnEscape: true,
                        withCloseButton: true,
                        classNames: { modal: 'w-[100%] max-w-[720px]' },
                        children: (
                          <PostThreadModal
                            integrationId={selectedItem.integration.id}
                            postRemoteId={selectedItem.threadKey as string}
                          />
                        ),
                      })
                    }
                  >
                    {t('inbox_view_thread', 'View full thread')}
                  </Button>
                )}
```

- [ ] **Step 3: Run the existing Inbox test suite to confirm no regression**

Run: `npx jest inbox.component.test.tsx`
Expected: PASS — the existing tests use a `linkedin` integration with an empty `/inbox/capabilities` response, so `selectedCapability` is `undefined` and the new button never renders; none of the existing assertions touch it.

- [ ] **Step 4: Manually verify in the browser**

Start the dev stack, connect a Facebook Page (or Instagram Business account) that has at least one published post with a comment and a reply to that comment, open the Inbox tab, select that post's comment item, click "View full thread", confirm:
- All comments and their nested replies render.
- Clicking the like icon on a comment actually likes it on Facebook/Instagram (check on the platform itself).
- Submitting a reply from the modal posts a real reply and it appears after the modal's re-fetch.
- For a YouTube or X item, no "View full thread" button appears at all.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/inbox/inbox.component.tsx \
        apps/frontend/src/components/inbox/use.inbox.hooks.ts
git commit -m "feat(inbox): surface the full comment thread from the Inbox detail pane"
```

---

## Self-Review Notes

- **Spec coverage:** provider capability additions (Task 1-3), on-demand thread fetch and like/reply backend routes (Task 4-6), frontend thread view with per-node like/reply (Task 7-9) — every section of the spec has a corresponding task. YouTube/X are explicitly left untouched (no task modifies them), matching "Out of scope."
- **Type consistency:** `InboxThreadNode` is defined once (Task 1, backend) and mirrored once (Task 7, frontend) with identical field names; `likeInboxComment`'s `{ liked, likeCount }` return shape is used identically in Task 2, 3, 5, and 8.
- **No placeholders:** the one open question (Instagram's lack of a "liked by me" read field) is resolved with a concrete, documented behavior (`likedByMe: false` always) rather than left as a TODO.
