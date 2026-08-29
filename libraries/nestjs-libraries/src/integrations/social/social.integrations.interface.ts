import { Integration } from '@prisma/client';

export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
}
export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]>;
  postAnalytics?(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
  ): Promise<AnalyticsData[]>;
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
  missing?(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}


export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    // Called the moment the platform confirms a publish, so the caller can
    // persist the remote id before any later step can fail — a retry after
    // a post-publish failure must not publish a duplicate.
    // A provider may also report an *unconfirmed* publish with
    // status 'in-progress' (postId = resume hint): the publish has been
    // initiated but may still fail, so the caller must only record it as a
    // resume hint, never as a completed publish.
    progress?: (response: PostResponse) => Promise<unknown> | unknown
  ): Promise<PostResponse[]>; // Schedules a new post

  postPending?(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    progress?: (response: PostResponse) => Promise<unknown> | unknown
  ): Promise<PostResponse[]>; // Like `post`, but may return a `pending` response the workflow resolves via checkPostStatus / finalizePost

  comment?(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post
}

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status, 'pending' means the workflow must poll checkPostStatus; 'in-progress' is a resume hint only
  pendingData?: any; // Opaque provider state used by checkPostStatus / finalizePost, never inspected by generic code
};

// Returned by checkPostStatus / finalizePost:
// 'pending' - the platform is still processing, poll again later
// 'ready' - processing is done, the workflow must call finalizePost to run the remaining mutations
// 'completed' - the post is fully published
//
// Contract: once finalizePost's mutations have actually gone through on the
// platform, checkPostStatus must return 'completed' - never 'ready' again -
// otherwise a finalizePost retry after an unknown-outcome failure would re-run
// the mutations and duplicate the post. The only exception: when finalizePost's
// mutation is idempotent (like setting a thumbnail), returning 'ready' again is
// allowed, since re-running it cannot duplicate anything.
export type PendingCheckResponse =
  | { status: 'pending'; pendingData: any }
  | { status: 'ready'; pendingData: any }
  | { status: 'completed'; postId: string; releaseURL: string };

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
  // The provider publish id / pending blob of a publish that is already in
  // flight for this post (from a previous attempt that died mid-poll). When
  // set, a provider that supports it should resume observing that publish
  // instead of initiating a new one.
  inFlight?: string;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
  id?: string; // Media.id, when the entry originates from the media library (used by deriveCompanionPosts's story_media_id lookup)
};

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration {
  identifier: string;
  refreshWait?: boolean;
  convertToJPEG?: boolean;
  stripLinks?: () => boolean;
  refreshCron?: boolean;
  dto?: any;
  maxLength: (additionalSettings?: any) => number;
  mediaLimits?: {
    image?: MediaLimit;
    video?: MediaLimit;
  };
  checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true>;
  checkMediaLimits(
    posts: Array<{ path: string; thumbnail?: string }[]>
  ): Promise<string | true>;
  checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
      hint?: string;
    }[]
  >;
  name: string;
  toolTip?: string;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) => Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  >;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
  /** Optional social-inbox capabilities for R13 honesty in the UI. */
  inboxCapabilities?(): InboxCapabilities;
  fetchInboxItems?(
    accessToken: string,
    integration: Integration
  ): Promise<FetchedInboxItem[]>;
  replyToInboxItem?(
    accessToken: string,
    item: InboxReplyTarget,
    message: string,
    integration: Integration
  ): Promise<{ remoteId: string }>;
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
  /**
   * Optional hook (R6/R15) letting a provider derive a Story Companion Post
   * from the settings/media of the post it is attached to. Called once from
   * the generic create/update/delete path in `posts.service.ts` — absent on
   * the interface (or simply not implemented) means "no companion, ever" for
   * that provider, so every non-Instagram provider is a silent no-op today.
   * The provider only *decides*; it never touches the database or Temporal
   * itself — the generic caller acts on the returned instruction (upsert or
   * cancel the companion row via the repository).
   */
  deriveCompanionPosts?(
    context: CompanionDerivationContext
  ): Promise<CompanionDerivationResult>;
}

/** What triggered the generic create/update/delete path to consult the hook. */
export type CompanionDerivationOperation = 'create' | 'update' | 'delete';

export type CompanionDerivationContext = {
  operation: CompanionDerivationOperation;
  /** The originating Feed post's own id (the companion link's target). */
  postId: string;
  integration: Integration;
  /** Feed post settings (parsed, provider-shaped), e.g. the "also share to Story" toggle. */
  settings: any;
  media: MediaContent[];
  /** The existing companion row for this Feed post, if one already exists. */
  /**
   * `inFlight` mirrors PostsService's `post:inflight:{id}` Redis marker
   * (irreversible remote step started, publish not yet confirmed) for this
   * companion — computed by the generic caller (posts.service.ts, which
   * owns that key) so a provider hook never needs its own Redis access or
   * knowledge of the key format.
   */
  existingCompanion?: {
    id: string;
    state: string;
    releaseId: string | null;
    inFlight: boolean;
  } | null;
};

/**
 * 'none'   - no companion should exist right now (toggle off / not applicable).
 * 'upsert' - create or update the companion with the given message/media/settings.
 * 'cancel' - an existing companion should be canceled (feed post edited to drop
 *            the toggle, deleted, etc.) — a no-op if no companion exists yet.
 */
export type CompanionDerivationResult =
  | { action: 'none' }
  | {
      action: 'upsert';
      message: string;
      media: MediaContent[];
      settings: any;
    }
  | { action: 'cancel' };

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

export type FetchedInboxItem = {
  type: 'COMMENT' | 'MENTION' | 'DM';
  remoteId: string;
  threadKey?: string | null;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  replyCapable: boolean;
  remoteUrl?: string | null;
  remoteCreatedAt?: string | Date | null;
};

export type InboxReplyTarget = {
  type: 'COMMENT' | 'MENTION' | 'DM';
  remoteId: string;
  threadKey?: string | null;
  authorId?: string | null;
};

export type MediaLimit = { maxSizeBytes: number };
