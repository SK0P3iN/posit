'use client';

import { FC, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import {
  InstagramCollaboratorsTagsField,
  InstagramTrialReelFields,
} from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.collaborators';
import { InstagramAudioSelector } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.audio';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InstagramPreview } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.preview';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import {
  StoryCompanionNotice,
  StorySlidePicker,
} from '@gitroom/frontend/components/new-launch/providers/story-slide-picker';

// Same warning glyph tiktok.provider.tsx uses for its inline restriction
// notice - reused here so both providers' "heads up before you schedule"
// banners look identical.
const WarningIcon: FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
      fill="currentColor"
    />
  </svg>
);

// Live daily publishing-cap read (R12). Own hook, called unconditionally
// once per settings-panel mount - per this repo's SWR/rules-of-hooks
// convention, each SWR call gets its own hook function rather than living
// inside a conditionally-invoked helper. Uses the existing generic
// /integrations/function dispatch (KTD5), same as InstagramAudioSelector's
// audioSearch call above.
const useInstagramPublishingLimit = () => {
  const { integration } = useIntegration();
  const customFunc = useCustomProviderFunction();
  const fetchLimit = useCallback(
    () => customFunc.get('publishingLimit', {}),
    [customFunc]
  );
  return useSWR(
    integration?.id ? `instagram-publishing-limit-${integration.id}` : null,
    fetchLimit,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
};

const InstagramSettings: FC = () => {
  const t = useT();
  const { watch, register, setValue } = useSettings();
  const { integration, value } = useIntegration();
  const {
    data: publishingLimitData,
    error: publishingLimitError,
    isLoading: publishingLimitLoading,
  } = useInstagramPublishingLimit();

  // The Audio API is only available with Facebook Login, not Instagram Login
  const supportsAudio = integration?.identifier === 'instagram';

  const postCurrentType = watch('post_type');
  // 'post' (KTD4) is the legacy alias already-queued posts may still carry.
  // It is never rewritten here - the dropdown below only renders a 'post'
  // <option> while it is still the loaded value (so it displays as Feed and
  // remains selected), and every conditional branch in this component keys
  // off `effectivePostType`, which folds legacy 'post' into 'feed' for
  // display/gating purposes only. Picking a new option always writes one of
  // the three real values.
  const effectivePostType = postCurrentType === 'post' ? 'feed' : postCurrentType;

  const media = value?.[0]?.image || [];
  const isSingleVideo =
    media.length === 1 && hasExtension(media[0]?.path, 'mp4');
  const isMultiMedia = media.length > 1;

  // AE1: Instagram no longer meaningfully supports a standalone Feed video
  // post - a single video always publishes as a Reel (see
  // InstagramProvider.postPending's isImplicitReel). Flag that substitution
  // here, persistently, rather than let it surface only as a Graph API
  // error at publish time.
  const showFeedVideoNotice = effectivePostType === 'feed' && isSingleVideo;

  // AE4: Stories can never be a carousel (checkValidity rejects this
  // server-side too) - flag it inline before the operator tries to publish.
  const showStoryCarouselError = effectivePostType === 'story' && isMultiMedia;

  // R9: the Reel cover is picked via the existing media library
  // (MediaComponent), not a raw URL field. MediaComponent's value/onChange
  // contract is a { id, path } media object, but cover_url (InstagramDto)
  // is a plain string, so this adapts between the two rather than storing
  // an object in a field the DTO validates as a string. A distinct `name`
  // (not the real form field) is passed to MediaComponent so its own
  // internal "load value from the form on mount" effect doesn't try to read
  // cover_url's string back out as a { id, path } object.
  const coverUrl = watch('cover_url');
  const coverMediaValue = useMemo(
    () => (coverUrl ? { id: coverUrl, path: coverUrl } : undefined),
    [coverUrl]
  );
  const onChangeCover = useCallback(
    (event: { target: { value?: { id: string; path: string } } }) => {
      setValue('cover_url', event.target.value?.path, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [setValue]
  );

  // KD2/KD8: defaults to the first slide when unset; a prior explicit pick
  // is never cleared on toggle-off, so it survives re-enabling the toggle.
  const storyMediaId = watch('story_media_id');
  const onSelectStorySlide = useCallback(
    (id: string) => {
      setValue('story_media_id', id, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [setValue]
  );

  const publishingLimitLabel = useMemo(() => {
    if (publishingLimitLoading) {
      return t(
        'instagram_daily_cap_loading',
        'Checking daily posting usage…'
      );
    }
    if (
      publishingLimitError ||
      publishingLimitData == null ||
      typeof publishingLimitData?.quota_usage !== 'number'
    ) {
      return t(
        'instagram_daily_cap_unavailable',
        'Daily posting usage unavailable'
      );
    }
    return t(
      'instagram_daily_cap_usage',
      'Daily posting usage: {{used}}/{{total}}',
      {
        used: publishingLimitData.quota_usage,
        total: publishingLimitData?.config?.quota_total ?? '?',
      }
    );
  }, [
    publishingLimitData,
    publishingLimitError,
    publishingLimitLoading,
    t,
  ]);

  return (
    <div className="flex flex-col">
      <Select
        label={t('label_post_type', 'Post Type')}
        {...register('post_type', {
          value: 'feed',
        })}
      >
        <option value="">{t('select_post_type', 'Select Post Type...')}</option>
        {/* Legacy alias (KTD4): while an already-queued post's stored value
            is still 'post', it's shown as its own "Feed" entry (selected,
            not rewritten) instead of the normal 'feed' option below - so the
            list never shows "Feed" twice, and picking any option here always
            writes one of the three real values going forward. */}
        {postCurrentType === 'post' ? (
          <option value="post">{t('post_type_feed', 'Feed')}</option>
        ) : (
          <option value="feed">{t('post_type_feed', 'Feed')}</option>
        )}
        <option value="reel">{t('post_type_reel', 'Reel')}</option>
        <option value="story">{t('post_type_story', 'Story')}</option>
      </Select>

      {showFeedVideoNotice && (
        <div className="bg-tableBorder p-[10px] mt-[10px] mb-[8px] rounded-[10px] flex gap-[10px] items-start text-[13px] text-balance">
          <div className="shrink-0 mt-[2px]">
            <WarningIcon />
          </div>
          <div>
            {t(
              'instagram_feed_video_becomes_reel',
              'Instagram no longer meaningfully supports a standalone Feed video post: with a single video attached, this will publish as a Reel instead. Switch Post Type to Reel to use Reel-only options, or add more media to keep it in Feed.'
            )}
          </div>
        </div>
      )}

      <div className="text-[12px] opacity-70 mt-[6px] mb-[18px]">
        {publishingLimitLabel}
      </div>

      {showStoryCarouselError && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-[10px] mb-[18px] rounded-[10px] text-[13px] text-balance">
          {t(
            'instagram_story_carousel_error',
            "Instagram Stories only support a single media item, not a carousel. Remove the extra media before scheduling this Story."
          )}
        </div>
      )}

      {effectivePostType === 'reel' && (
        <div className="flex flex-col gap-[18px]">
          <Checkbox
            {...register('share_to_feed', {
              value: true,
            })}
            label={t(
              'instagram_share_to_feed',
              'Also show this Reel in Feed'
            )}
          />

          <MediaComponent
            type="image"
            name="__instagram_reel_cover_picker"
            label={t('instagram_reel_cover', 'Reel cover (optional)')}
            description={t(
              'instagram_reel_cover_description',
              "Pick an image from your media library to use as this Reel's cover. Leave empty and Instagram will pick a frame from the video."
            )}
            value={coverMediaValue}
            onChange={onChangeCover}
          />

          <InstagramAudioSelector
            label={t(
              'instagram_audio_label',
              'Audio (Reels only - single video)'
            )}
            disabled={!supportsAudio}
            {...register('audio')}
          />

          <InstagramTrialReelFields />
        </div>
      )}

      {/* KTD6/R1: same block for Feed and Reel - Reels are always a single
          video (never a carousel), so the picker below simply no-ops there. */}
      {(effectivePostType === 'feed' || effectivePostType === 'reel') && (
        <div className="mt-[8px] flex flex-col gap-[6px]">
          <Checkbox
            {...register('also_share_to_story', {
              value: false,
            })}
            label={t(
              'instagram_also_share_to_story',
              'Also publish media as Story (no link sticker)'
            )}
          />
          <StoryCompanionNotice />
          {watch('also_share_to_story') && (
            <StorySlidePicker
              media={media}
              storyMediaId={storyMediaId}
              onSelect={onSelectStorySlide}
            />
          )}
        </div>
      )}

      {/* Collaborators apply to any non-Story post (see InstagramProvider.postPending:
          `collaborators` is sent whenever `!isStory`, not only for Reels) - rendered
          for both Feed and Reel, unlike share_to_feed/cover_url/audio/Trial Reel
          which are genuinely Reel-only (Meta requires media_type=REELS for those). */}
      {effectivePostType !== 'story' && <InstagramCollaboratorsTagsField />}
    </div>
  );
};

export default withProvider<InstagramDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: InstagramSettings,
  CustomPreviewComponent: InstagramPreview,
  dto: InstagramDto,
  maximumCharacters: 2200,
  comments: 'no-media',
});
