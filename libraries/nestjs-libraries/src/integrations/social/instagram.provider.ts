import {
  AnalyticsData,
  AuthTokenDetails,
  CompanionDerivationContext,
  CompanionDerivationResult,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

// Instagram Graph API version used across every call site in this file
// (OAuth, page discovery, container create/publish, status/permalink, music,
// inbox, ig_audio, analytics). v20.0 sunsets 2026-09-24; v22.0 has runway to
// May 2027 and already supports share_to_feed, cover_url and trial_params.
export const GRAPH_API_VERSION = 'v22.0';

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram';
  name = 'Instagram\n(Facebook Business)';
  isBetweenSteps = true;
  toolTip =
    'Your Facebook page selection is shared across all your Meta channels, check all relevant pages\nInstagram must be business and connected to a Facebook page, check this page too';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
  ];
  override maxConcurrentJob = 400;
  editor = 'normal' as const;
  dto = InstagramDto;
  maxLength() {
    return 2200;
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    // Story-specific (R4/AE4): Stories publish one item at a time
    // (finalizePost's 'stories' branch loops each container as its own
    // story), they never support a carousel - reject before the generic
    // 10-media carousel check below so the message stays Story-scoped.
    if (settings?.post_type === 'story' && firstPost.length > 1) {
      return 'Instagram Stories only support a single media item, not a carousel';
    }
    if (firstPost.length > 10) {
      return 'Instagram carousel only supports up to 10 media attachments';
    }
    if (this.assetBoolean(settings?.is_trial_reel)) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    if (settings?.audio?.id) {
      if (settings?.post_type === 'story') {
        return 'Audio can only be added to Reels, not to Stories';
      }
      if ((firstPost?.length ?? 0) > 1) {
        return 'Audio can only be added to a single video Reel';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Audio can only be added to a video Reel';
      }
    }
    return true;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }
    if (body.indexOf('2207081') > -1) {
      return {
        type: 'bad-body' as const,
        value: "This account doesn't support Trial Reels",
      };
    }

    if (
      body.indexOf('REVOKED_ACCESS_TOKEN') > -1 ||
      body.indexOf('"error_subcode":33') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (/"code":\s*190\b/.test(body)) {
      return {
        type: 'refresh-token' as const,
        value:
          'The Instagram access token is invalid, please reconnect the channel',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207082') > -1) {
      return {
        type: 'retry' as const,
        value: 'Could not upload your media',
      }
    }

    if (body.indexOf('2207077') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram Video download failed',
      };
    }

    if (body.indexOf('too little or too many attachments') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram carousel should have between 2 and 10 media attachments',
      }
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    if (body.indexOf('param collaborators is not allowed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Collaborators are not allowed for carousel',
      };
    }

    return undefined;
  }

  async reConnect(
    id: string,
    requiredId: string,
    token: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const [accessToken, userToken] = token.split('___');
    const findPage = (await this.pages(accessToken)).find(
      (p) => p.id === requiredId
    );

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage?.pageId!,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth` +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        // Re-prompt permissions/assets the user previously declined, so a
        // bad page grant can be repaired by reconnecting
        `&auth_type=rerequest` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const getAccessToken = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token` +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token, expires_in, ...all } = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token` +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(token: string) {
    const [accessToken, userToken] = token.split('___');
    const seenPageIds = new Set<string>();
    const allFacebookPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              allFacebookPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/${GRAPH_API_VERSION}/${business.id}/owned_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/${GRAPH_API_VERSION}/${business.id}/client_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    const onlyConnectedAccounts = (
      await Promise.all(
        allFacebookPages
          .filter((f: any) => f.instagram_business_account)
          .map(async (p: any) => {
            // Pages without an access_token were never granted to the app
            // in the OAuth dialog — selecting them would store a broken
            // "undefined___..." token
            const { access_token } = await (
              await fetch(
                `https://graph.facebook.com/${GRAPH_API_VERSION}/${p.id}?fields=access_token&access_token=${accessToken}`
              )
            ).json();

            if (!access_token) {
              return null;
            }

            return {
              pageId: p.id,
              ...(await (
                await fetch(
                  `https://graph.facebook.com/${GRAPH_API_VERSION}/${p.instagram_business_account.id}?fields=name,profile_picture_url&access_token=${accessToken}`
                )
              ).json()),
              id: p.instagram_business_account.id,
            };
          })
      )
    ).filter(Boolean);

    return onlyConnectedAccounts.map((p: any) => ({
      pageId: p.pageId,
      id: p.id,
      name: p.name,
      picture: { data: { url: p.profile_picture_url } },
    }));
  }

  async fetchPageInformation(
    token: string,
    data: { pageId: string; id: string }
  ) {
    const [accessToken, userToken] = token.split('___');
    const { access_token, ...all } = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${data.pageId}?fields=access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    const { id, name, profile_picture_url, username } = await (
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${data.id}?fields=username,name,profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      picture: profile_picture_url,
      access_token: access_token + '___' + accessToken,
      username,
    };
  }

  // Single, read-only status check of a media container - the polling loops
  // that used to live inside post() are now driven by the post workflow.
  private async igContainerStatus(
    containerId: string,
    checkToken: string,
    type: string
  ): Promise<string> {
    const { status_code, status } = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${containerId}?access_token=${checkToken}&fields=status_code,status`,
        undefined,
        '',
        0,
        true
      )
    ).json();

    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ status_code, status }),
        '{}',
        status || 'Instagram could not process the media'
      );
    }

    return status_code;
  }

  // The post is live, the permalink is only cosmetic: never fail (and risk
  // re-publishing) a live post over it.
  private async igPermalink(
    mediaId: string,
    checkToken: string,
    type: string,
    integration: Integration
  ): Promise<string> {
    try {
      const { permalink } = await (
        await this.fetch(
          `https://${type}/${GRAPH_API_VERSION}/${mediaId}?fields=permalink&access_token=${checkToken}`
        )
      ).json();
      return permalink;
    } catch (err) {
      return `https://www.instagram.com/${integration.profile}`;
    }
  }

  async postPending(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    progress?: (response: PostResponse) => Promise<unknown> | unknown,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken] = token.split('___');
    const [firstPost] = postDetails;

    // Resume a previous attempt that created containers / carousel but died
    // before finalize confirmed the publish — never create new media.
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

    const isStory = firstPost.settings.post_type === 'story';
    // 'feed' / 'reel' are the explicit choices the composer offers (R1).
    // 'post' is the legacy alias (KTD4): its behavior below is byte-for-byte
    // the same implicit detection that existed before explicit post_type
    // values were added - single video -> REELS, everything else unchanged
    // (R2), so already-queued posts keep publishing exactly as before.
    const requestedPostType = firstPost.settings.post_type;
    const isTrialReel = this.assetBoolean(firstPost.settings.is_trial_reel);
    // share_to_feed (R8) has no documented Meta default, so it's always sent
    // explicitly on every Reel publish rather than omitted. Default true
    // (appears in Feed) when unset, matching today's implicit behavior where
    // a single video always published in a way that also surfaced in Feed.
    const shareToFeed =
      typeof firstPost?.settings?.share_to_feed === 'boolean'
        ? firstPost.settings.share_to_feed
        : true;
    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const caption =
          firstPost.media?.length === 1
            ? `&caption=${encodeURIComponent(firstPost.message)}`
            : ``;
        const isCarousel =
          (firstPost?.media?.length || 0) > 1 && !isStory
            ? `&is_carousel_item=true`
            : ``;

        // Reel cover (R9): cover_url and thumb_offset are never sent in the
        // same request - Meta's docs say cover_url silently wins if both are
        // present, so thumb_offset is omitted whenever cover_url is set.
        const coverParams = firstPost?.settings?.cover_url
          ? `&cover_url=${encodeURIComponent(firstPost.settings.cover_url)}`
          : `&thumb_offset=${m?.thumbnailTimestamp || 0}`;

        const isVideo = hasExtension(m.path, 'mp4');
        // Explicit Reel always gets the REELS shape. A single video under
        // `feed`/legacy `post` still routes through REELS too - Instagram no
        // longer meaningfully supports a standalone Feed video post (AE1).
        const isReel =
          requestedPostType === 'reel' ||
          (isVideo && firstPost?.media?.length === 1);

        const mediaType = isStory
          ? isVideo
            ? `video_url=${m.path}&media_type=STORIES`
            : `image_url=${m.path}&media_type=STORIES`
          : isReel
          ? `video_url=${m.path}&media_type=REELS${coverParams}&share_to_feed=${shareToFeed}`
          : isVideo
          ? `video_url=${m.path}&media_type=VIDEO${coverParams}`
          : `image_url=${m.path}`;

        const trialParams = isTrialReel
          ? `&trial_params=${encodeURIComponent(
              JSON.stringify({
                graduation_strategy:
                  firstPost.settings.graduation_strategy || 'MANUAL',
              })
            )}`
          : ``;

        const collaborators =
          firstPost?.settings?.collaborators?.length && !isStory
            ? `&collaborators=${JSON.stringify(
                firstPost?.settings?.collaborators.map((p) => p.label)
              )}`
            : ``;

        // audio_configuration is only supported for Reels (single video, not a story)
        // and only with Facebook Login (not Instagram Login / graph.instagram.com)
        const audioConfiguration =
          firstPost?.settings?.audio?.id &&
          type === 'graph.facebook.com' &&
          !isStory &&
          firstPost?.media?.length === 1 &&
          hasExtension(m.path, 'mp4')
            ? `&audio_configuration=${encodeURIComponent(
                JSON.stringify({
                  audio_id: firstPost.settings.audio.id,
                  ...(typeof firstPost.settings.audio.audio_volume !==
                  'undefined'
                    ? { audio_volume: +firstPost.settings.audio.audio_volume }
                    : {}),
                  ...(typeof firstPost.settings.audio.video_volume !==
                  'undefined'
                    ? { video_volume: +firstPost.settings.audio.video_volume }
                    : {}),
                })
              )}`
            : ``;

        const { id: photoId } = await (
          await this.fetch(
            `https://${type}/${GRAPH_API_VERSION}/${id}/media?${mediaType}${isCarousel}${collaborators}${trialParams}${audioConfiguration}&access_token=${accessToken}${caption}`,
            {
              method: 'POST',
            },
            'instagram-create-media'
          )
        ).json();

        return photoId;
      }) || []
    );

    // Containers are invisible until media_publish runs: the processing wait
    // and the publish itself move to checkPostStatus / finalizePost so a
    // failure there can never re-create (and re-publish) the whole post.
    const pendingData = {
      type,
      postType:
        isStory && medias.length > 1
          ? 'stories'
          : medias.length === 1
          ? 'single'
          : 'carousel',
      containers: medias,
      message: firstPost?.message || '',
      postDbId: firstPost.id,
    };

    // Publish boundary for the container-create step: a crash/retry after this
    // must resume these containers, not create new ones.
    await progress?.({
      id: firstPost.id,
      postId: JSON.stringify(pendingData),
      releaseURL: '',
      status: 'in-progress',
    });

    return [
      {
        id: firstPost.id,
        postId: '',
        releaseURL: '',
        status: 'pending',
        pendingData,
      },
    ];
  }

  override async checkPostStatus(
    token: string,
    pendingData: {
      type: string;
      postType: 'stories' | 'single' | 'carousel';
      containers: string[];
      message?: string;
      carouselId?: string;
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    const [accessToken, userToken] = token.split('___');
    const checkToken = userToken || accessToken;

    // the carousel container was already created: wait for it
    if (pendingData.carouselId) {
      const status = await this.igContainerStatus(
        pendingData.carouselId,
        checkToken,
        pendingData.type
      );

      if (status === 'IN_PROGRESS') {
        return { status: 'pending', pendingData };
      }

      // a previous finalizePost published but died before reporting: the post
      // is live, never publish again
      if (status === 'PUBLISHED') {
        return {
          status: 'completed',
          postId: pendingData.carouselId,
          releaseURL: `https://www.instagram.com/${integration.profile}`,
        };
      }

      // only an exact FINISHED match means the container is ready to publish -
      // an unexpected/unrecognized status code is never silently treated as
      // ready, it just keeps polling
      if (status !== 'FINISHED') {
        return { status: 'pending', pendingData };
      }

      return { status: 'ready', pendingData };
    }

    for (const containerId of pendingData.containers) {
      const status = await this.igContainerStatus(
        containerId,
        checkToken,
        pendingData.type
      );

      if (status === 'IN_PROGRESS') {
        return { status: 'pending', pendingData };
      }

      if (status === 'PUBLISHED') {
        // a previous finalizePost died mid-way: a single post is fully live,
        // stories are resumed by finalizePost (it skips published containers)
        if (pendingData.postType === 'single') {
          return {
            status: 'completed',
            postId: containerId,
            releaseURL: `https://www.instagram.com/${integration.profile}`,
          };
        }
      } else if (status !== 'FINISHED') {
        // only an exact FINISHED (or the already-handled PUBLISHED) match
        // moves a container towards ready - an unexpected status code is
        // never silently treated as ready, it just keeps polling
        return { status: 'pending', pendingData };
      }
    }

    return { status: 'ready', pendingData };
  }

  override async finalizePost(
    token: string,
    pendingData: {
      type: string;
      postType: 'stories' | 'single' | 'carousel';
      containers: string[];
      message?: string;
      carouselId?: string;
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    const [accessToken, userToken] = token.split('___');
    const checkToken = userToken || accessToken;
    const igId = integration.internalId;

    if (pendingData.postType === 'stories') {
      // Stories don't support carousels - publish each media as a separate
      // story, skipping containers a previous (crashed) run already published
      let lastMediaId = '';
      for (const mediaCreationId of pendingData.containers) {
        const status = await this.igContainerStatus(
          mediaCreationId,
          checkToken,
          pendingData.type
        );
        if (status === 'PUBLISHED') {
          continue;
        }

        const { id: mediaId } = await (
          await this.fetch(
            `https://${pendingData.type}/${GRAPH_API_VERSION}/${igId}/media_publish?creation_id=${mediaCreationId}&access_token=${accessToken}&field=id`,
            {
              method: 'POST',
            }
          )
        ).json();
        lastMediaId = mediaId;
      }

      return {
        status: 'completed',
        postId: lastMediaId || pendingData.containers.at(-1)!,
        releaseURL: !lastMediaId
          ? `https://www.instagram.com/${integration.profile}`
          : await this.igPermalink(
              lastMediaId,
              checkToken,
              pendingData.type,
              integration
            ),
      };
    }

    if (pendingData.postType === 'carousel' && !pendingData.carouselId) {
      // create the carousel container and hand back to the workflow to wait
      // for it (an orphan container from a crashed run is invisible, so
      // re-running this is safe)
      const { id: containerId } = await (
        await this.fetch(
          `https://${pendingData.type}/${GRAPH_API_VERSION}/${igId}/media?caption=${encodeURIComponent(
            pendingData.message || ''
          )}&media_type=CAROUSEL&children=${encodeURIComponent(
            pendingData.containers.join(',')
          )}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      return {
        status: 'pending',
        pendingData: { ...pendingData, carouselId: containerId },
      };
    }

    const creationId =
      pendingData.postType === 'carousel'
        ? pendingData.carouselId
        : pendingData.containers[0];

    const { id: mediaId } = await (
      await this.fetch(
        `https://${pendingData.type}/${GRAPH_API_VERSION}/${igId}/media_publish?creation_id=${creationId}&access_token=${accessToken}&field=id`,
        {
          method: 'POST',
        }
      )
    ).json();

    return {
      status: 'completed',
      postId: mediaId,
      releaseURL: await this.igPermalink(
        mediaId,
        checkToken,
        pendingData.type,
        integration
      ),
    };
  }

  // Old blocking behavior, kept for workflow versions before v1.0.6 that don't
  // know how to resolve a `pending` response.
  async post(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    progress?: (response: PostResponse) => Promise<unknown> | unknown,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const [response] = await this.postPending(
      id,
      token,
      postDetails,
      integration,
      progress,
      type
    );

    let pendingData = response.pendingData;
    const started = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Cap below the 10-minute activity timeout of the old workflows using
      // this method: failing here (non-retryable) is safe, timing the
      // activity out is not - a retried activity would publish again.
      if (Date.now() - started > 8 * 60 * 1000) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'Media processing timed out'
        );
      }

      const check = await this.checkPostStatus(token, pendingData, integration);

      if (check.status === 'pending') {
        pendingData = check.pendingData;
        await timer(30000);
        continue;
      }

      const result =
        check.status === 'ready'
          ? await this.finalizePost(token, check.pendingData, integration)
          : check;

      if (result.status === 'completed') {
        await progress?.({
          id: firstPost.id,
          postId: result.postId,
          releaseURL: result.releaseURL,
          status: 'success',
        });
        return [
          {
            id: firstPost.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          },
        ];
      }

      pendingData = result.pendingData;
      await timer(30000);
    }
  }

  /**
   * Story Companion Post hook (R5/R6/R15). Reads the Feed post's own
   * "also share to Story" toggle from settings and decides whether the
   * generic caller (posts.service.ts, U3) should upsert or cancel the
   * linked companion — this method never publishes or touches the
   * database/Temporal itself.
   *
   * Field name: `also_share_to_story` (boolean | undefined). It doesn't
   * exist on `InstagramDto` yet (U5 adds it) - read defensively so this
   * unit works whether or not the field is present on `context.settings`.
   *
   * The companion's `settings` is `{ post_type: 'story' }`, the exact
   * shape `postPending` already reads via `firstPost.settings.post_type
   * === 'story'` to route media through the STORIES publish path
   * (`media_type=STORIES`) instead of building a new one.
   */
  async deriveCompanionPosts(
    context: CompanionDerivationContext
  ): Promise<CompanionDerivationResult> {
    const alsoShareToStory = context.settings?.also_share_to_story === true;

    if (context.operation === 'delete' || !alsoShareToStory) {
      return this.deriveCompanionCancellation(context.existingCompanion);
    }

    // Toggle is on: (re)generate the companion, unless it has already gone
    // live or is irreversibly in flight - resent rather than left alone.
    if (this.isCompanionLocked(context.existingCompanion)) {
      return { action: 'none' };
    }

    return {
      action: 'upsert',
      // Instagram Stories don't surface a caption the way Feed posts do,
      // and `CompanionDerivationContext` doesn't carry the Feed post's own
      // text (R7: the companion republishes the same *media*, not text).
      message: '',
      media: context.media,
      settings: { post_type: 'story' },
    };
  }

  /**
   * KTD7's lock check, shared by the upsert-regenerate gate above and the
   * cancellation gate below: an existing companion is untouchable once any
   * of `state === 'PUBLISHED'`, a `releaseId` is already assigned, or its
   * `inFlight` marker is set (an irreversible remote step started, publish
   * not yet confirmed — computed by the generic caller from PostsService's
   * `post:inflight:{id}` Redis marker, since this plain class isn't
   * NestJS-DI-injected and can't read that itself).
   */
  private isCompanionLocked(
    existingCompanion: CompanionDerivationContext['existingCompanion']
  ): boolean {
    return !!(
      existingCompanion &&
      (existingCompanion.state === 'PUBLISHED' ||
        existingCompanion.releaseId != null ||
        existingCompanion.inFlight)
    );
  }

  /**
   * KTD7's cancellation gate. If `isCompanionLocked` says "an irreversible
   * remote step may already be under way or done", this returns
   * `{ action: 'none' }` rather than a new bespoke cancellation heuristic.
   * That companion is just a normal Post row flowing through the same
   * postWorkflowV107 as any other post, so the *existing* UNCONFIRMED:
   * reconciliation machinery (`assertCanRepublish` blocking republish,
   * `confirm-published` letting the user resolve it) already protects it
   * exactly the way it protects every other post the workflow can't
   * confirm - there is nothing to build here, only something to avoid
   * stepping on by not canceling.
   */
  private deriveCompanionCancellation(
    existingCompanion: CompanionDerivationContext['existingCompanion']
  ): CompanionDerivationResult {
    if (!existingCompanion || this.isCompanionLocked(existingCompanion)) {
      return { action: 'none' };
    }

    return { action: 'cancel' };
  }

  override inboxCapabilities() {
    return { comments: true, mentions: false, dms: false, embeddable: true };
  }

  override async fetchInboxItems(
    token: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ) {
    const [accessToken] = token.split('___');
    const media = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${integration.internalId}/media?fields=id,permalink,comments.limit(20){id,text,username,timestamp,from}&limit=10&access_token=${accessToken}`
      )
    ).json();

    const items = [];
    for (const post of media?.data || []) {
      for (const comment of post?.comments?.data || []) {
        items.push({
          type: 'COMMENT' as const,
          remoteId: String(comment.id),
          threadKey: String(post.id),
          authorName: comment.username || comment.from?.username || null,
          authorId: comment.from?.id || null,
          body: comment.text || '',
          replyCapable: true,
          remoteUrl: post.permalink || null,
          remoteCreatedAt: comment.timestamp || null,
        });
      }
    }
    return items;
  }

  override async replyToInboxItem(
    token: string,
    item: {
      type: 'COMMENT' | 'MENTION' | 'DM';
      remoteId: string;
      threadKey?: string | null;
    },
    message: string,
    _integration: Integration,
    type = 'graph.facebook.com'
  ) {
    const [accessToken] = token.split('___');
    const { id } = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${item.remoteId}/replies?message=${encodeURIComponent(
          message
        )}&access_token=${accessToken}`,
        { method: 'POST' }
      )
    ).json();
    return { remoteId: String(id) };
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [commentPost] = postDetails;

    const { id: commentId } = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${postId}/comments?message=${encodeURIComponent(
          commentPost.message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    // Get the permalink from the parent post
    const { permalink } = await (
      await this.fetch(
        `https://${type}/${GRAPH_API_VERSION}/${postId}?fields=permalink&access_token=${
          userToken || accessToken
        }`
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: commentId,
        releaseURL: permalink,
        status: 'success',
      },
    ];
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  async analytics(
    id: string,
    token: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const until = dayjs().startOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await fetch(
        `https://${type}/${GRAPH_API_VERSION}/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/${GRAPH_API_VERSION}/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  music(accessToken: string, data: { q: string }) {
    return this.fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }

  // https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api/
  // empty search_query returns trending audio
  @Tool({
    description:
      'Search audio (music or original sounds) to attach to a Reel via the "audio" setting, an empty query returns trending audio',
    dataSchema: [
      {
        key: 'q',
        type: 'string',
        description: 'Search query, leave empty for trending audio',
      },
      {
        key: 'type',
        type: 'string',
        description: 'Either "music" or "original_sound", defaults to "music"',
      },
    ],
  })
  async audioSearch(
    token: string,
    data: { q?: string; type?: 'music' | 'original_sound' },
    internalId?: string
  ) {
    const [accessToken, userToken] = token.split('___');
    const audioType =
      data?.type === 'original_sound' ? 'original_sound' : 'music';

    const { audio } = await (
      await this.fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/ig_audio?audio_type=${audioType}&user_id=${internalId}${
          data?.q ? `&search_query=${encodeURIComponent(data.q)}` : ''
        }&access_token=${userToken || accessToken}`
      )
    ).json();

    return (audio || []).map((audio: any) => ({
      id: audio.audio_id,
      title: audio.title || '',
      artist: audio.display_artist || audio.ig_username || '',
      image:
        audio.cover_artwork_thumbnail_uri ||
        audio.cover_artwork_thumbnail_url ||
        audio.profile_picture_url ||
        '',
      duration: audio.duration_in_ms || 0,
      previewUrl: audio.download_url || '',
    }));
  }

  // https://developers.facebook.com/docs/instagram-platform/content-publishing/publishing-limit
  // Live daily publishing-cap read (R12): a thin passthrough of Meta's raw
  // response (quota_usage/config.quota_total/config.quota_duration), never
  // a hardcoded cap - Meta's docs don't state a fixed number and secondary
  // sources disagree on it precisely for that reason, so nothing here
  // reshapes or renames what Meta sends back. Reached through the existing
  // generic provider-dispatch endpoint (POST /integrations/function ->
  // functionIntegration, KTD5), the same pattern already used for
  // music()/audioSearch() - no new route, no Manager/Service layer.
  // Matches postAnalytics()'s convention below of catching its own failures
  // and returning a safe fallback: this is a live status read for display,
  // so a Meta-side hiccup should surface as "unknown" to the composer
  // rather than throw through the dispatch layer.
  async publishingLimit(token: string, data?: any, internalId?: string) {
    const [accessToken, userToken] = token.split('___');

    try {
      return await (
        await this.fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${internalId}/content_publishing_limit?fields=config,quota_usage&access_token=${
            userToken || accessToken
          }`
        )
      ).json();
    } catch (err) {
      console.error('Error fetching Instagram publishing limit:', err);
      return null;
    }
  }

  async postAnalytics(
    integrationId: string,
    token: string,
    postId: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch media insights from Instagram Graph API
      const { data } = await (
        await fetch(
          `https://${type}/${GRAPH_API_VERSION}/${postId}/insights?metric=views,reach,saved,likes,comments,shares&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'reach':
            label = 'Reach';
            break;
          case 'engagement':
            label = 'Engagement';
            break;
          case 'saved':
            label = 'Saves';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'comments':
            label = 'Comments';
            break;
          case 'shares':
            label = 'Shares';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Instagram post analytics:', err);
      return [];
    }
  }
}
