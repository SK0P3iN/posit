'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import {
  FacebookDto,
  FACEBOOK_PRESETS,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { getPresetBackground } from '@gitroom/frontend/components/new-launch/providers/facebook/facebook.background';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { FacebookPreview } from '@gitroom/frontend/components/new-launch/providers/facebook/facebook.preview';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useEffect } from 'react';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { StorySlidePicker } from '@gitroom/frontend/components/new-launch/providers/story-slide-picker';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

const postType = [
  {
    value: 'post',
    label: 'Post',
  },
  {
    value: 'story',
    label: 'Story',
  },
];

export const FacebookSettings = () => {
  const t = useT();
  const { register, watch, setValue } = useSettings();
  const { value } = useIntegration();
  const postCurrentType = watch('post_type');
  const preset = watch('text_format_preset_id');

  // Facebook background presets only render on text-only Page posts (no media).
  const hasMedia = !!value?.some((p) => !!p.image?.length);
  const presetAvailable = postCurrentType !== 'story' && !hasMedia;
  const selectedBg = getPresetBackground(preset);

  // Clear any selected background when it can no longer apply (story / media),
  // so a stray combination never reaches the provider.
  useEffect(() => {
    if (!presetAvailable && preset) {
      setValue('text_format_preset_id', '');
    }
  }, [presetAvailable, preset, setValue]);

  // R5/KTD7: "Also share to Story" only applies to a post that has media
  // and is not itself already a Story - named distinctly from `hasMedia`
  // above (which gates the unrelated background-preset field on different
  // "any selected post has media" semantics).
  const media = value?.[0]?.image || [];
  const hasStoryMedia = media.length > 0;
  const alsoShareToStory = watch('also_share_to_story');
  const storyMediaId = watch('story_media_id');
  const canShareToStory = hasStoryMedia && postCurrentType !== 'story';

  // Mirrors the presetAvailable auto-clear above: drop the toggle's own
  // state if all media is removed after it was enabled.
  useEffect(() => {
    if (!canShareToStory && alsoShareToStory) {
      setValue('also_share_to_story', false);
    }
  }, [canShareToStory, alsoShareToStory, setValue]);

  const onSelectStorySlide = (id: string) => {
    setValue('story_media_id', id, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <>
      <div className="pt-[20px]">
        <Select
          label="Post Type"
          {...register('post_type', {
            value: 'post',
          })}
        >
          <option value="">
            {t('select_post_type', 'Select Post Type...')}
          </option>
          {postType.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>

      {postCurrentType !== 'story' && (
        <Input
          label={'Embedded URL (only for text Post)'}
          {...register('url')}
        />
      )}

      {canShareToStory && (
        <div className="mt-[8px] flex flex-col gap-[6px]">
          <Checkbox
            {...register('also_share_to_story', { value: false })}
            label={t('facebook_also_share_to_story', 'Also share to Story')}
          />
          <div className="text-[12px] opacity-70 text-balance">
            {t(
              'facebook_also_share_to_story_description',
              'This republishes the same media as a separate scheduled Story post. It creates an additional post that also counts toward your organization’s monthly post limit; if you’re at your plan’s limit, the Story companion will silently be skipped.'
            )}
          </div>
          {watch('also_share_to_story') && (
            <StorySlidePicker
              media={media}
              storyMediaId={storyMediaId}
              onSelect={onSelectStorySlide}
              // KD6/KTD8: Facebook's own Feed publish path only actually
              // publishes the first slide when it's a video, dropping the
              // rest of the carousel - flag that divergence here rather
              // than let it surface only as a mismatch after publish.
              showFeedDivergenceNotice={hasExtension(media[0]?.path, 'mp4')}
            />
          )}
        </div>
      )}

      {presetAvailable && (
        <>
          <Select
            label="Background (applies to text-only posts shorter than 130 characters)"
            hideErrors
            {...register('text_format_preset_id')}
            style={
              selectedBg
                ? { background: selectedBg.background, color: selectedBg.text }
                : undefined
            }
          >
            <option value="" style={{ background: '#ffffff', color: '#1c1e21' }}>
              {t('facebook_background_none', 'None (plain text)')}
            </option>
            {FACEBOOK_PRESETS.map((item) => {
              const bg = getPresetBackground(item.id);
              return (
                <option
                  key={item.id}
                  value={item.id}
                  style={
                    bg ? { background: bg.background, color: bg.text } : undefined
                  }
                >
                  {item.name}
                </option>
              );
            })}
          </Select>
          <div className="text-[12px] opacity-70 mt-[8px]">
            {t(
              'facebook_background_note',
              'Unofficial list: the colors shown are approximate, an unsupported background is dropped (published as plain text)'
            )}
          </div>
        </>
      )}
    </>
  );
};

export default withProvider<FacebookDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: FacebookSettings,
  CustomPreviewComponent: FacebookPreview,
  dto: FacebookDto,
  maximumCharacters: 63206,
});
