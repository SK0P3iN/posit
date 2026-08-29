import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  CreationMethod,
  Post,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
          deletedAt: null,
        },
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          lt: dayjs.utc().toDate(),
        },
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
        publishDate: true,
      },
    });
  }

  getOldPosts(orgId: string, date: string) {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        image: images,
      },
    });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    const endDate = dayjs.utc(query.endDate).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          organizationId: orgId,
        },
        deletedAt: null,
        parentPostId: null,
        ...(query.customer
          ? {
              integration: {
                customerId: query.customer,
              },
            }
          : {}),
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        error: true,
        intervalInDays: true,
        group: true,
        creationMethod: true,
        mediaMissing: true,
        tags: {
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
            refreshNeeded: true,
          },
        },
      },
    });

    return list.reduce((all, post) => {
      if (!post.intervalInDays) {
        return [...all, post];
      }

      const addMorePosts = [];
      let startingDate = dayjs.utc(post.publishDate);
      while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
        if (dayjs(startingDate).isSameOrAfter(dayjs.utc(post.publishDate))) {
          addMorePosts.push({
            ...post,
            publishDate: startingDate.toDate(),
            actualDate: post.publishDate,
          });
        }

        startingDate = startingDate.add(post.intervalInDays, 'days');
      }

      return [...all, ...addMorePosts];
    }, [] as any[]);
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'published' ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      // Published posts were already posted (publishDate in the past), so fetch
      // all of them; everything else stays upcoming. Ordering handles the rest.
      ...(stateFilter === 'published'
        ? {}
        : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
      },
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          error: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          mediaMissing: true,
          tags: {
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
              refreshNeeded: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    return {
      posts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string) {
    await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
      },
      select: {
        id: true,
      },
    });
  }

  getPostsByGroup(orgId: string, group: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          select: {
            tag: true,
          },
        },
      },
    });
  }

  getPost(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
      },
    });
  }

  confirmAlreadyLive(id: string, orgId: string) {
    return this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        state: 'ERROR',
        error: {
          startsWith: 'UNCONFIRMED:',
        },
        deletedAt: null,
      },
      data: {
        state: 'PUBLISHED',
        error: null,
        releaseId: 'user-confirmed',
        releaseURL: '',
      },
    });
  }

  getPostReleaseId(id: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
      },
      select: {
        releaseId: true,
        releaseURL: true,
      },
    });
  }

  updateReleaseId(id: string, orgId: string, releaseId: string) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
        releaseId: 'missing',
      },
      data: {
        releaseId: String(releaseId),
      },
    });
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    // Boundary persist may have already marked PUBLISHED; do not demote to
    // ERROR when a later workflow step fails (notification / update race).
    if (state === 'ERROR') {
      const current = await this._post.model.post.findUnique({
        where: { id },
        select: { state: true },
      });
      if (current?.state === 'PUBLISHED') {
        return this._post.model.post.findUnique({
          where: { id },
          include: {
            integration: {
              select: {
                providerIdentifier: true,
              },
            },
          },
        });
      }
    }

    const update = await this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state,
        ...(err
          ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        await this._errors.model.errors.create({
          data: {
            message: typeof err === 'string' ? err : JSON.stringify(err),
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body: typeof body === 'string' ? body : JSON.stringify(body),
          },
        });
      } catch (err) {}
    }

    return update;
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    return this._post.model.post.update({
      where: {
        organizationId: orgId,
        id,
      },
      data: {
        publishDate: dayjs(date).toDate(),
        // schedule: set state to QUEUE (or DRAFT if it was a draft)
        // update: don't change the state
        ...(action === 'schedule'
          ? {
              state: isDraft ? 'DRAFT' : 'QUEUE',
              releaseId: null,
              releaseURL: null,
            }
          : {}),
      },
    });
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number
  ) {
    const posts: Post[] = [];
    const uuid = uuidv4();

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        publishDate: dayjs(date).toDate(),
        integration: {
          connect: {
            id: body.integration.id,
            organizationId: orgId,
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group: uuid,
        intervalInDays: inter ? +inter : null,
        approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
        ...(type === 'create' ? { creationMethod } : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await this._post.model.post.upsert({
          where: {
            id: value.id || uuidv4(),
          },
          create: { ...updateData('create') },
          update: {
            ...updateData('update'),
            lastMessage: {
              disconnect: true,
            },
            submittedForOrder: {
              disconnect: true,
            },
          },
        })
      );

      if (posts.length === 1) {
        await this._tagsPosts.model.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
            },
          },
        });

        if (tags.length) {
          const tagsList = await this._tags.model.tags.findMany({
            where: {
              orgId: orgId,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await this._post.model.post.update({
              where: {
                id: posts[posts.length - 1].id,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    const previousPost = body.group
      ? (
          await this._post.model.post.findFirst({
            where: {
              group: body.group,
              deletedAt: null,
              parentPostId: null,
            },
            select: {
              id: true,
            },
          })
        )?.id!
      : undefined;

    if (body.group) {
      await this._post.model.post.updateMany({
        where: {
          group: body.group,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return { previousPost, posts };
  }

  /**
   * Story Companion Post (R6/R15): one companion per Feed post, enforced by
   * the `storyCompanionOfPostId` @@unique constraint on `Post`. Keying the
   * upsert on that column (instead of an id, like `createOrUpdatePost` keys
   * on `id`) makes "does a companion already exist" atomic — two
   * near-simultaneous derivations for the same Feed post race on the same
   * unique key and settle on one row, never two.
   */
  async upsertCompanionPost(
    orgId: string,
    parentPostId: string,
    integrationId: string,
    publishDate: Date,
    message: string,
    media: unknown[],
    settings: unknown,
    creationMethod: CreationMethod
  ) {
    return this._post.model.post.upsert({
      where: {
        storyCompanionOfPostId: parentPostId,
      },
      create: {
        publishDate,
        content: message,
        group: uuidv4(),
        state: 'QUEUE',
        image: JSON.stringify(media),
        settings: JSON.stringify(settings),
        creationMethod,
        integration: {
          connect: {
            id: integrationId,
            organizationId: orgId,
          },
        },
        organization: {
          connect: {
            id: orgId,
          },
        },
        storyCompanionOfPost: {
          connect: {
            id: parentPostId,
          },
        },
      },
      update: {
        publishDate,
        content: message,
        image: JSON.stringify(media),
        settings: JSON.stringify(settings),
        state: 'QUEUE',
        releaseId: null,
        releaseURL: null,
        error: null,
        deletedAt: null,
      },
    });
  }

  /** The Feed post's current companion row (if any), for the derivation hook's context. */
  getCompanionForPost(orgId: string, parentPostId: string) {
    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        storyCompanionOfPostId: parentPostId,
        deletedAt: null,
      },
      select: {
        id: true,
        state: true,
        releaseId: true,
      },
    });
  }

  /**
   * Mechanical half of companion cancellation (soft-delete only — mirrors
   * the group-scoped `updateMany` half of the top-level `deletePost`, but
   * scoped to the companion's own id/group instead of the Feed post's).
   * The workflow-terminate half stays in the service, same as `deletePost`,
   * since this repository has no Temporal client.
   */
  async cancelCompanionPost(orgId: string, parentPostId: string) {
    const companion = await this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        storyCompanionOfPostId: parentPostId,
        deletedAt: null,
      },
      select: {
        id: true,
        group: true,
      },
    });

    if (!companion) {
      return null;
    }

    await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group: companion.group,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return companion;
  }

  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  getPostById(id: string, org?: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(org ? { organizationId: org } : {}),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  async getComments(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.update({
      where: {
        id,
      },
      data: {
        name: body.name,
        color: body.color,
      },
    });
  }

  deleteTag(id: string, orgId: string) {
    return this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    content: string
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
      },
    });
  }

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

  async getPostByForWebhookId(postId: string) {
    return this._post.model.post.findMany({
      where: {
        id: postId,
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  findEditablePostsPossiblyReferencingMedia(
    orgId: string,
    mediaIds: string[]
  ) {
    if (!mediaIds.length) {
      return Promise.resolve([]);
    }

    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        state: {
          in: [State.DRAFT, State.QUEUE, State.ERROR],
        },
        OR: mediaIds.flatMap((id) => [
          { image: { contains: id } },
          { settings: { contains: id } },
        ]),
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        state: true,
        image: true,
        settings: true,
        title: true,
      },
    });
  }

  findAllEditablePostsWithMedia(orgId: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        state: {
          in: [State.DRAFT, State.QUEUE, State.ERROR],
        },
        OR: [
          { image: { not: null } },
          { settings: { not: null } },
        ],
      },
      select: {
        id: true,
        image: true,
        settings: true,
      },
    });
  }

  clearMediaMissing(orgId: string, postId: string) {
    return this._post.model.post.updateMany({
      where: {
        id: postId,
        organizationId: orgId,
        mediaMissing: true,
      },
      data: {
        mediaMissing: false,
      },
    });
  }

  async stripMediaFromPosts(orgId: string, mediaIds: string[]) {
    const posts = await this.findEditablePostsPossiblyReferencingMedia(
      orgId,
      mediaIds
    );
    const idSet = new Set(mediaIds);
    const updated: string[] = [];

    for (const post of posts) {
      const nextImage = this.stripMediaIdsFromImageJson(post.image, idSet);
      const nextSettings = this.stripMediaIdsFromSettingsJson(
        post.settings,
        idSet
      );

      if (
        nextImage === post.image &&
        nextSettings === post.settings
      ) {
        continue;
      }

      await this._post.model.post.update({
        where: { id: post.id },
        data: {
          image: nextImage,
          settings: nextSettings,
          mediaMissing: true,
        },
      });
      updated.push(post.id);
    }

    return updated;
  }

  private stripMediaIdsFromImageJson(
    image: string | null,
    idSet: Set<string>
  ) {
    if (!image) {
      return image;
    }

    try {
      const parsed = JSON.parse(image);
      if (!Array.isArray(parsed)) {
        return image;
      }
      const filtered = parsed.filter(
        (item) => !item?.id || !idSet.has(item.id)
      );
      return JSON.stringify(filtered);
    } catch {
      return image;
    }
  }

  private stripMediaIdsFromSettingsJson(
    settings: string | null,
    idSet: Set<string>
  ) {
    if (!settings) {
      return settings;
    }

    try {
      const parsed = JSON.parse(settings);
      const stripped = this.stripMediaDtoNodes(parsed, idSet);
      return JSON.stringify(stripped);
    } catch {
      return settings;
    }
  }

  private stripMediaDtoNodes(value: unknown, idSet: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value
        .filter(
          (item) =>
            !(
              item &&
              typeof item === 'object' &&
              'id' in item &&
              'path' in item &&
              idSet.has((item as { id: string }).id)
            )
        )
        .map((item) => this.stripMediaDtoNodes(item, idSet));
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (
        'id' in record &&
        'path' in record &&
        typeof record.id === 'string' &&
        idSet.has(record.id)
      ) {
        return null;
      }

      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record)) {
        next[key] = this.stripMediaDtoNodes(child, idSet);
      }
      return next;
    }

    return value;
  }
}
