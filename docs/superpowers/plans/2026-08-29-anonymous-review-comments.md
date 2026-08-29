# Anonymous Review-Page Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone without a Postiz account leave a name + comment on a post's public review page (`/p/[id]`), notify the whole org in-app and by email when that happens, and show a comment-count badge on the post's calendar card.

**Architecture:** Extend the existing `Comments` Prisma model to allow a null `userId` plus a guest `authorName`. Add a public `POST /public/posts/:id/comments` endpoint (no auth) that enforces a hard cap of 3 anonymous comments per post, alongside the existing public `GET` endpoints on the same controller. Reuse the existing `NotificationService.inAppNotification` org-wide broadcast (in-app + email) — call it after any comment is created, anonymous or not. Add a comment count to the existing calendar posts query and surface it as a small badge on the post card, following the existing `CreationMethodBadge`/`MediaMissingBadge` patterns.

**Tech Stack:** NestJS (backend), Prisma (`db push`, no migration files in this repo), Next.js/React + SWR (frontend), class-validator DTOs, Jest.

**Spec:** `docs/superpowers/specs/2026-08-29-anonymous-review-comments-design.md`

## Global Constraints

- Anonymous comment cap: exactly 3 anonymous comments per post, global (not per-visitor). Logged-in users are unaffected by the cap.
- Anonymous commenter provides name only — no email/contact field.
- Notification recipients: whole organization, via the existing `NotificationService.inAppNotification(orgId, subject, message, true, false, 'info')` call — no new notification mechanism.
- Never use raw SQL — all data access through Prisma via the repository layer.
- Follow DTO → Controller → Service → Repository for every new/changed backend code path.
- No dependency additions; no new frontend UI libraries.

---

### Task 1: Schema — allow anonymous comments

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma:453-471` (the `Comments` model)

**Interfaces:**
- Produces: `Comments.userId` becomes `String?` (optional FK), `Comments.user` becomes `User?` (optional relation), new field `Comments.authorName String?`. All later tasks depend on this shape.

- [ ] **Step 1: Edit the `Comments` model**

Replace the current model:

```prisma
model Comments {
  id             String       @id @default(uuid())
  content        String
  organizationId String
  postId         String
  userId         String
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?
  organization   Organization @relation(fields: [organizationId], references: [id])
  post           Post         @relation(fields: [postId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@index([createdAt])
  @@index([organizationId])
  @@index([userId])
  @@index([postId])
  @@index([deletedAt])
}
```

with:

```prisma
model Comments {
  id             String       @id @default(uuid())
  content        String
  organizationId String
  postId         String
  userId         String?
  authorName     String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?
  organization   Organization @relation(fields: [organizationId], references: [id])
  post           Post         @relation(fields: [postId], references: [id])
  user           User?        @relation(fields: [userId], references: [id])

  @@index([createdAt])
  @@index([organizationId])
  @@index([userId])
  @@index([postId])
  @@index([deletedAt])
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `pnpm run prisma-generate`
Expected: succeeds with no errors; `@prisma/client`'s `Comments` type now shows `userId: string | null`, `authorName: string | null`, `user?: User | null`.

- [ ] **Step 3: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/schema.prisma
git commit -m "feat(comments): allow anonymous comments in schema"
```

---

### Task 2: `CreatePublicCommentDto`

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/create.public.comment.dto.ts`
- Test: `libraries/nestjs-libraries/src/dtos/posts/create.public.comment.dto.spec.ts`

**Interfaces:**
- Produces: `CreatePublicCommentDto { name: string; content: string }`, consumed by Task 5's controller.

- [ ] **Step 1: Write the failing test**

```typescript
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePublicCommentDto } from './create.public.comment.dto';

describe('CreatePublicCommentDto', () => {
  it('accepts a valid name and content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a missing content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects a name over 100 characters', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'a'.repeat(101),
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects content over 2000 characters', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: 'a'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest create.public.comment.dto.spec.ts`
Expected: FAIL — `Cannot find module './create.public.comment.dto'`

- [ ] **Step 3: Write the DTO**

```typescript
import { IsString, MaxLength } from 'class-validator';

export class CreatePublicCommentDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(2000)
  content: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest create.public.comment.dto.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/dtos/posts/create.public.comment.dto.ts libraries/nestjs-libraries/src/dtos/posts/create.public.comment.dto.spec.ts
git commit -m "feat(comments): add CreatePublicCommentDto"
```

---

### Task 3: Repository — anonymous comment counting and creation

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts:1026-1040` (add two methods after the existing `createComment`)
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts` (append a new `describe` block near the existing `PostsRepository` one)

**Interfaces:**
- Consumes: `PrismaRepository<'comments'>` (already injected as `this._comments`), `PrismaRepository<'post'>` (already injected as `this._post`).
- Produces: `PostsRepository.countAnonymousComments(postId: string): Promise<number>` and `PostsRepository.createPublicComment(orgId: string, postId: string, name: string, content: string): Promise<Comments>`, consumed by Task 4's service.

- [ ] **Step 1: Write the failing test**

Append to `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`, after the existing `describe('PostsRepository - Story Companion Post persistence (U3, KTD2/KTD3)', ...)` block:

```typescript
describe('PostsRepository - anonymous review comments', () => {
  function makeFakeCommentsDelegate() {
    const rows: any[] = [];
    return {
      rows,
      count: jest.fn(async ({ where }: any) => {
        return rows.filter(
          (r) => r.postId === where.postId && r.userId === null
        ).length;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `comment-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
    };
  }

  function makeRepository() {
    const commentsDelegate = makeFakeCommentsDelegate();
    const repository = new PostsRepository(
      {} as any,
      {} as any,
      { model: { comments: commentsDelegate } } as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repository, commentsDelegate };
  }

  it('countAnonymousComments counts only comments with a null userId on that post', async () => {
    const { repository, commentsDelegate } = makeRepository();
    commentsDelegate.rows.push(
      { postId: 'post-1', userId: null },
      { postId: 'post-1', userId: null },
      { postId: 'post-1', userId: 'user-1' },
      { postId: 'post-2', userId: null }
    );

    const count = await repository.countAnonymousComments('post-1');

    expect(count).toBe(2);
    expect(commentsDelegate.count).toHaveBeenCalledWith({
      where: { postId: 'post-1', userId: null },
    });
  });

  it('createPublicComment inserts a comment with no userId and the given authorName', async () => {
    const { repository, commentsDelegate } = makeRepository();

    const result = await repository.createPublicComment(
      'org-1',
      'post-1',
      'Jane Reviewer',
      'Looks great!'
    );

    expect(commentsDelegate.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        postId: 'post-1',
        authorName: 'Jane Reviewer',
        content: 'Looks great!',
      },
    });
    expect(result.authorName).toBe('Jane Reviewer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest posts.service.spec.ts -t "anonymous review comments"`
Expected: FAIL — `repository.countAnonymousComments is not a function`

- [ ] **Step 3: Add the repository methods**

In `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts`, immediately after the existing `createComment` method (ends at line 1040):

```typescript
  countAnonymousComments(postId: string) {
    return this._comments.model.comments.count({
      where: {
        postId,
        userId: null,
      },
    });
  }

  createPublicComment(
    orgId: string,
    postId: string,
    name: string,
    content: string
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        postId,
        authorName: name,
        content,
      },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest posts.service.spec.ts -t "anonymous review comments"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts
git commit -m "feat(comments): add repository methods for anonymous comments"
```

---

### Task 4: Service — public comment creation, cap enforcement, notification

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:1-5` (imports), `:68-79` (constructor), `:1486-1493` (existing `createComment`, add a new `createPublicComment` + private `notifyNewComment` near it)
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts:60-145` (`makePostsService` helper — add a `notificationService` fake and pass it into `new PostsService(...)`)

**Interfaces:**
- Consumes: `PostsRepository.getPost(id, includeIntegration?, orgId?, isFirst?)` (existing, `posts.repository.ts:370`), `PostsRepository.countAnonymousComments(postId)` and `PostsRepository.createPublicComment(orgId, postId, name, content)` (Task 3), `NotificationService.inAppNotification(orgId, subject, message, sendEmail, digest, type)` (existing, `notification.service.ts:41`).
- Produces: `PostsService.createPublicComment(postId: string, name: string, content: string): Promise<Comments>`, consumed by Task 5's controller. `PostsService.createComment` keeps its existing signature but now also triggers a notification.

- [ ] **Step 1: Update the shared test fake and write the failing tests**

In `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`, modify `makePostsService` to accept and wire a `notificationService` fake. Change the function signature and body (around line 60-142):

```typescript
function makePostsService(overrides?: {
  postRepository?: Partial<Record<string, jest.Mock>>;
  provider?: any;
  subscription?: Partial<Record<string, jest.Mock>>;
  organization?: Partial<Record<string, jest.Mock>>;
  notificationService?: Partial<Record<string, jest.Mock>>;
}) {
  const postRepository = {
    createOrUpdatePost: jest.fn().mockResolvedValue({
      posts: [
        {
          id: 'feed-post-1',
          publishDate: new Date('2026-01-01T00:00:00Z'),
          state: 'QUEUE',
        },
      ],
    }),
    clearMediaMissing: jest.fn(),
    getCompanionForPost: jest.fn().mockResolvedValue(null),
    upsertCompanionPost: jest.fn().mockResolvedValue({
      id: 'companion-1',
      group: 'companion-group-1',
      state: 'QUEUE',
    }),
    cancelCompanionPost: jest.fn().mockResolvedValue(null),
    countPostsFromDay: jest.fn().mockResolvedValue(0),
    getPost: jest.fn().mockResolvedValue({
      id: 'post-1',
      organizationId: 'org-1',
    }),
    countAnonymousComments: jest.fn().mockResolvedValue(0),
    createPublicComment: jest.fn().mockResolvedValue({
      id: 'comment-1',
      authorName: 'Jane Reviewer',
      content: 'Looks great!',
    }),
    createComment: jest.fn().mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      content: 'Looks great!',
    }),
    ...overrides?.postRepository,
  } as unknown as PostsRepository;

  const provider = overrides?.provider ?? {
    stripLinks: () => false,
  };

  const integrationManager = {
    getSocialIntegration: jest.fn(() => provider),
  };

  const integrationService = {
    getIntegrationById: jest.fn().mockResolvedValue(fakeIntegration),
  };

  const mediaService = {
    extractMediaIdsFromValues: jest.fn(() => []),
    recordAttachedMedia: jest.fn(),
    getMediaById: jest.fn(),
  };

  const shortLinkService = {
    convertTextToShortLinks: jest.fn(),
  };

  const openaiService = {};
  const temporalService = makeTemporalServiceFake();
  const refreshIntegrationService = {};

  const subscriptionService = {
    getSubscriptionByOrganizationId: jest
      .fn()
      .mockResolvedValue({ subscriptionTier: 'PRO' }),
    getSubscription: jest
      .fn()
      .mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00Z') }),
    ...overrides?.subscription,
  };

  const organizationService = {
    getOrgById: jest
      .fn()
      .mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00Z') }),
    ...overrides?.organization,
  };

  const notificationService = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    ...overrides?.notificationService,
  };

  const service = new PostsService(
    postRepository,
    integrationManager as any,
    integrationService as any,
    mediaService as any,
    shortLinkService as any,
    openaiService as any,
    temporalService as any,
    refreshIntegrationService as any,
    subscriptionService as any,
    organizationService as any,
    notificationService as any
  );

  return { service, postRepository, integrationManager, provider, notificationService };
}
```

Then add a new `describe` block at the end of the file:

```typescript
describe('PostsService - anonymous review comments', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates a public comment and notifies the org when under the anonymous cap', async () => {
    const { service, postRepository, notificationService } = makePostsService({
      postRepository: {
        getPost: jest.fn().mockResolvedValue({ id: 'post-1', organizationId: 'org-1' }),
        countAnonymousComments: jest.fn().mockResolvedValue(2),
      },
    });

    const result = await service.createPublicComment(
      'post-1',
      'Jane Reviewer',
      'Looks great!'
    );

    expect(postRepository.createPublicComment).toHaveBeenCalledWith(
      'org-1',
      'post-1',
      'Jane Reviewer',
      'Looks great!'
    );
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      expect.any(String),
      expect.stringContaining('/p/post-1'),
      true,
      false,
      'info'
    );
    expect(result).toEqual({
      id: 'comment-1',
      authorName: 'Jane Reviewer',
      content: 'Looks great!',
    });
  });

  it('rejects a 4th anonymous comment on the same post', async () => {
    const { service, postRepository, notificationService } = makePostsService({
      postRepository: {
        getPost: jest.fn().mockResolvedValue({ id: 'post-1', organizationId: 'org-1' }),
        countAnonymousComments: jest.fn().mockResolvedValue(3),
      },
    });

    await expect(
      service.createPublicComment('post-1', 'Jane Reviewer', 'One more!')
    ).rejects.toThrow();

    expect(postRepository.createPublicComment).not.toHaveBeenCalled();
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });

  it('throws when the post does not exist', async () => {
    const { service } = makePostsService({
      postRepository: {
        getPost: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.createPublicComment('missing-post', 'Jane Reviewer', 'Hi')
    ).rejects.toThrow();
  });

  it('notifies the org when an authenticated comment is created', async () => {
    const { service, postRepository, notificationService } = makePostsService();

    await service.createComment('org-1', 'user-1', 'post-1', 'Looks great!');

    expect(postRepository.createComment).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'post-1',
      'Looks great!'
    );
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      expect.any(String),
      expect.stringContaining('/p/post-1'),
      true,
      false,
      'info'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest posts.service.spec.ts -t "anonymous review comments"`
Expected: FAIL — `service.createPublicComment is not a function`, and constructor arity mismatch errors from the other existing describe blocks (they now pass an extra `notificationService` argument the current constructor doesn't accept, which is harmless — TypeScript may warn but Jest's ts-jest will still fail to compile until Step 3 adds the parameter). Confirm the failure is about the missing method/param, not something else.

- [ ] **Step 3: Update the service**

In `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`, add `NotFoundException` to the existing `@nestjs/common` import (line 1-5):

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
```

Add the import for `NotificationService` near the other service imports (after the `IntegrationService` import, currently line 22):

```typescript
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
```

Add it as the last constructor parameter (currently lines 68-79):

```typescript
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService
  ) {}
```

Replace the existing `createComment` method (currently lines 1486-1493) with:

```typescript
  async createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    const created = await this._postRepository.createComment(
      orgId,
      userId,
      postId,
      comment
    );
    await this.notifyNewComment(orgId, postId);
    return created;
  }

  async createPublicComment(postId: string, name: string, content: string) {
    const post = await this._postRepository.getPost(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const anonymousCount = await this._postRepository.countAnonymousComments(
      postId
    );
    if (anonymousCount >= 3) {
      throw new BadRequestException(
        'This post has reached its review comment limit'
      );
    }

    const created = await this._postRepository.createPublicComment(
      post.organizationId,
      postId,
      name,
      content
    );
    await this.notifyNewComment(post.organizationId, postId);
    return created;
  }

  private async notifyNewComment(orgId: string, postId: string) {
    await this._notificationService.inAppNotification(
      orgId,
      'New comment on your post',
      `Someone left a new comment on one of your posts. Check it out: ${process.env.FRONTEND_URL}/p/${postId}`,
      true,
      false,
      'info'
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest posts.service.spec.ts`
Expected: PASS — all tests in the file, including the pre-existing Story Companion Post suites (which now build `PostsService` with the extra `notificationService` argument) and the four new tests.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts
git commit -m "feat(comments): notify org on new comments, add anonymous comment creation with cap"
```

---

### Task 5: Public endpoint

**Files:**
- Modify: `apps/backend/src/api/routes/public.controller.ts:74-77` (add a new `POST` route right after the existing `getComments` route)

**Interfaces:**
- Consumes: `PostsService.createPublicComment(postId, name, content)` (Task 4), `CreatePublicCommentDto` (Task 2).
- Produces: `POST /public/posts/:id/comments` — no auth guard, request body validated by the DTO via the app's existing global `ValidationPipe`.

- [ ] **Step 1: Add the import and route**

In `apps/backend/src/api/routes/public.controller.ts`, add the DTO import near the top (after the `AgentGraphInsertService` import, currently line 21):

```typescript
import { CreatePublicCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.public.comment.dto';
```

Add the new route immediately after the existing `getComments` method (currently lines 74-77):

```typescript
  @Post(`/posts/:id/comments`)
  async createPublicComment(
    @Param('id') postId: string,
    @Body() body: CreatePublicCommentDto
  ) {
    return this._postsService.createPublicComment(
      postId,
      body.name,
      body.content
    );
  }
```

- [ ] **Step 2: Typecheck the backend**

Run: `pnpm run prisma-generate && pnpm exec tsc -p apps/backend/tsconfig.app.json --noEmit`
Expected: no errors. (If the backend uses a different build check command, use the project's standard `pnpm run build` scoped to backend instead — confirm via `package.json` if this exact command isn't present.)

- [ ] **Step 3: Manually verify the endpoint**

Start the backend locally per the project's normal dev command, then:

```bash
curl -X POST http://localhost:3000/public/posts/<a-real-post-id>/comments \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Reviewer", "content": "Looks great!"}'
```

Expected: `200` with the created comment JSON on the first 3 calls for that post id, `400` on the 4th.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/api/routes/public.controller.ts
git commit -m "feat(comments): expose public endpoint for anonymous comment creation"
```

---

### Task 6: Calendar comment count

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts:174-223` (the `getPosts` method's `select` and its `reduce`)
- Modify: `libraries/helpers/src/utils/posts.list.minify.ts:16-31` (`POST_ITEM_KEYS`)
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts` (extend the `PostsRepository - anonymous review comments` describe block from Task 3, or add a sibling one)

**Interfaces:**
- Produces: each post object returned by `PostsRepository.getPosts` and `PostsRepository.getPostsList` (both go through `minifyPostItem`) now carries a flat `commentsCount: number` field. Consumed by Task 8's frontend badge.

- [ ] **Step 1: Write the failing test**

Add to `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`:

```typescript
describe('PostsRepository - calendar comment count', () => {
  function makeFakePostDelegateWithCount(count: number) {
    return {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'post-1',
          publishDate: new Date('2026-01-01T00:00:00Z'),
          intervalInDays: null,
          _count: { comments: count },
        },
      ]),
    };
  }

  it('flattens the comments _count into a commentsCount field', async () => {
    const postDelegate = makeFakePostDelegateWithCount(2);
    const repository = new PostsRepository(
      { model: { post: postDelegate } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const result = await repository.getPosts('org-1', {
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-01-02T00:00:00Z',
    } as any);

    expect(result[0].commentsCount).toBe(2);
    expect((result[0] as any)._count).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest posts.service.spec.ts -t "calendar comment count"`
Expected: FAIL — `result[0].commentsCount` is `undefined`

- [ ] **Step 3: Update the repository**

In `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts`, add `_count` to the `select` block of `getPosts` (currently ending at line 200, just before the closing `},` of `select`):

```typescript
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
            refreshNeeded: true,
          },
        },
        _count: {
          select: {
            comments: true,
          },
        },
      },
    });

    return list.reduce((all, post: any) => {
      const { _count, ...rest } = post;
      const flattened = { ...rest, commentsCount: _count.comments };

      if (!flattened.intervalInDays) {
        return [...all, flattened];
      }

      const addMorePosts = [];
      let startingDate = dayjs.utc(flattened.publishDate);
      while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
        if (dayjs(startingDate).isSameOrAfter(dayjs.utc(flattened.publishDate))) {
          addMorePosts.push({
            ...flattened,
            publishDate: startingDate.toDate(),
            actualDate: flattened.publishDate,
          });
        }

        startingDate = startingDate.add(flattened.intervalInDays, 'days');
      }

      return [...all, ...addMorePosts];
    }, [] as any[]);
  }
```

This replaces the existing `select` closing block and the whole `return list.reduce(...)` block (currently lines 191-224) — the only change inside the loop is destructuring `_count` off each `post` and flattening it to `commentsCount` before the existing interval-expansion logic runs unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest posts.service.spec.ts -t "calendar comment count"`
Expected: PASS

- [ ] **Step 5: Add the minify key mapping**

In `libraries/helpers/src/utils/posts.list.minify.ts`, add `commentsCount: 'cc'` to `POST_ITEM_KEYS` (currently lines 16-31):

```typescript
const POST_ITEM_KEYS: Record<string, string> = {
  id: 'i',
  content: 'c',
  publishDate: 'd',
  releaseURL: 'u',
  releaseId: 'ri',
  state: 's',
  error: 'e',
  group: 'g',
  tags: 'tg',
  integration: 'n',
  intervalInDays: 'iv',
  actualDate: 'ad',
  creationMethod: 'cm',
  mediaMissing: 'mm',
  commentsCount: 'cc',
};
```

- [ ] **Step 6: Run the full posts service/repository suite**

Run: `pnpm exec jest posts.service.spec.ts`
Expected: PASS (no regressions in the other describe blocks)

- [ ] **Step 7: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts libraries/helpers/src/utils/posts.list.minify.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts
git commit -m "feat(comments): surface comment count on calendar post data"
```

---

### Task 7: Frontend — anonymous comment form on the review page

**Files:**
- Modify: `apps/frontend/src/components/preview/comments.components.tsx` (full rewrite of the two exported components)

**Interfaces:**
- Consumes: `GET /public/posts/:id/comments` (existing, now also returns `authorName` on anonymous comments), `POST /public/posts/:id/comments` (Task 5, body `{ name, content }`), `POST /posts/:id/comments` (existing, unchanged).
- Produces: `CommentsComponents` (same exported name/props `{ postId: string }`, used by `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx:192` — no caller changes needed).

- [ ] **Step 1: Replace the file**

```tsx
'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { FieldValues, SubmitHandler, useForm } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const ANONYMOUS_COMMENT_LIMIT = 3;

const SendIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-send me-2 h-4 w-4"
  >
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const useComments = (postId: string) => {
  const fetch = useFetch();
  const loadComments = useCallback(async () => {
    return (await fetch(`/public/posts/${postId}/comments`)).json();
  }, [postId]);
  return useSWR('comments', loadComments);
};

const CommentsList: FC<{
  comments: any[];
}> = ({ comments }) => {
  const t = useT();
  const mapUsers = useMemo(() => {
    return comments.reduce(
      (all: any, current: any) => {
        if (current.userId) {
          all.users[current.userId] = all.users[current.userId] || all.counter++;
        }
        return all;
      },
      {
        users: {},
        counter: 1,
      }
    ).users;
  }, [comments]);

  if (!comments.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('comments', 'Comments')}</h3>
      {comments.map((comment: any) => (
        <div
          key={comment.id}
          className="flex space-x-3 border-t border-tableBorder py-3"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-semibold">
                {comment.userId
                  ? `${t('user', 'User')}${mapUsers[comment.userId]}`
                  : comment.authorName}
              </h3>
            </div>
            <p className="text-sm text-gray-300">{comment.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

const AuthedCommentForm: FC<{
  postId: string;
  onPosted: () => void;
}> = ({ postId, onPosted }) => {
  const fetch = useFetch();
  const t = useT();
  const { handleSubmit, register, setValue } = useForm();
  const submit: SubmitHandler<FieldValues> = useCallback(
    async (e) => {
      setValue('comment', '');
      await fetch(`/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(e),
      });
      onPosted();
    },
    [postId, onPosted]
  );

  return (
    <form className="flex-1 space-y-2" onSubmit={handleSubmit(submit)}>
      <textarea
        {...register('comment', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[98px] text-sm ring-offset-background placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-none text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder="Add a comment..."
        defaultValue={''}
      />
      <div className="flex justify-end">
        <Button type="submit">
          <SendIcon />
          {t('post', 'Post')}
        </Button>
      </div>
    </form>
  );
};

const AnonymousCommentForm: FC<{
  postId: string;
  onPosted: () => void;
  atLimit: boolean;
}> = ({ postId, onPosted, atLimit }) => {
  const fetch = useFetch();
  const t = useT();
  const { handleSubmit, register, setValue } = useForm();
  const submit: SubmitHandler<FieldValues> = useCallback(
    async (e) => {
      setValue('content', '');
      await fetch(`/public/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(e),
      });
      onPosted();
    },
    [postId, onPosted]
  );

  if (atLimit) {
    return (
      <p className="text-sm text-gray-400">
        {t(
          'review_comment_limit_reached',
          'This post has reached its review comment limit.'
        )}
      </p>
    );
  }

  return (
    <form className="flex-1 space-y-2" onSubmit={handleSubmit(submit)}>
      <input
        {...register('name', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[40px] text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder={t('your_name', 'Your name')}
        maxLength={100}
        defaultValue={''}
      />
      <textarea
        {...register('content', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[98px] text-sm ring-offset-background placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-none text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder={t('add_a_comment', 'Add a comment...')}
        maxLength={2000}
        defaultValue={''}
      />
      <div className="flex justify-end">
        <Button type="submit">
          <SendIcon />
          {t('post', 'Post')}
        </Button>
      </div>
    </form>
  );
};

export const CommentsComponents: FC<{
  postId: string;
}> = (props) => {
  const { postId } = props;
  const user = useUser();
  const { data, mutate, isLoading } = useComments(postId);

  if (isLoading || !data) {
    return null;
  }

  const comments = data.comments || [];
  const anonymousCount = comments.filter((c: any) => !c.userId).length;

  return (
    <>
      <div className="mb-6 flex space-x-3">
        {user?.id ? (
          <AuthedCommentForm postId={postId} onPosted={mutate} />
        ) : (
          <AnonymousCommentForm
            postId={postId}
            onPosted={mutate}
            atLimit={anonymousCount >= ANONYMOUS_COMMENT_LIMIT}
          />
        )}
      </div>
      <CommentsList comments={comments} />
    </>
  );
};
```

- [ ] **Step 2: Manual verification**

Start the frontend dev server, open a post's `/p/[id]` page:
- Logged out: confirm the name+comment form appears (not the old login button), existing comments are visible with their real display names, submitting adds a new comment showing the entered name, and after 3 anonymous comments the form is replaced by the limit message.
- Logged in: confirm the original textarea-only form still works and comments still show as `User1`/`User2`/etc.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/preview/comments.components.tsx
git commit -m "feat(comments): allow anonymous name+comment submission on review page"
```

---

### Task 8: Frontend — calendar comment-count badge

**Files:**
- Create: `apps/frontend/src/components/launches/comment.count.badge.tsx`
- Modify: `apps/frontend/src/components/launches/calendar.tsx:38` (type import), `:990-996` (the `post` prop type), `:1093-1101` (render the new badge)

**Interfaces:**
- Consumes: `post.commentsCount` (Task 6), added to the `Post` type used by this card component.
- Produces: `CommentCountBadge` component, exported for use in `calendar.tsx`.

- [ ] **Step 1: Create the badge component**

```tsx
'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const CommentCountBadge: FC<{
  count: number;
}> = ({ count }) => {
  const t = useT();

  if (!count) {
    return null;
  }

  return (
    <div
      className="absolute -bottom-[4px] -left-[4px] z-10 flex items-center gap-[4px] px-[6px] h-[18px] rounded-full bg-[#2563eb] text-[10px] font-[700] text-white cursor-pointer"
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'comment_count_tooltip',
        'Number of comments on this post'
      )}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <span>{count}</span>
    </div>
  );
};
```

- [ ] **Step 2: Wire it into the calendar post card**

In `apps/frontend/src/components/launches/calendar.tsx`, add the import next to the `MediaMissingBadge` import (currently lines 61-64):

```typescript
import {
  MediaMissingBadge,
  mediaMissingRingClass,
} from '@gitroom/frontend/components/media/media.missing.badge';
import { CommentCountBadge } from '@gitroom/frontend/components/launches/comment.count.badge';
```

Extend the `post` prop type (currently lines 990-996):

```typescript
  post: Post & {
    integration: Integration;
    tags: {
      tag: Tags;
    }[];
    commentsCount?: number;
  };
```

Render the badge next to the other absolute-positioned badges (currently lines 1093-1101):

```typescript
      {post.mediaMissing && <MediaMissingBadge />}
      <CommentCountBadge count={post.commentsCount || 0} />
      {showCreationMethodBadge && (
        <div className="absolute -bottom-[4px] -right-[4px] z-10">
          <CreationMethodBadge
            creationMethod={post.creationMethod}
            ringColor="var(--new-bgColor)"
          />
        </div>
      )}
```

- [ ] **Step 3: Manual verification**

Start the frontend dev server, open the calendar view for an organization with a post that has comments (create one via Task 7's flow first): confirm a small blue comment-count badge appears in the bottom-left corner of that post's card, and that it does not appear on posts with zero comments or collide visually with the media-missing/creation-method badges.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/launches/comment.count.badge.tsx apps/frontend/src/components/launches/calendar.tsx
git commit -m "feat(comments): show comment count badge on calendar post cards"
```
