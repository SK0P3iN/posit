'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';

interface StorySlideMedia {
  id: string;
  path: string;
  thumbnail?: string;
}

interface StorySlidePickerProps {
  media: StorySlideMedia[];
  storyMediaId?: string;
  onSelect: (id: string) => void;
  /** KD6/KTD8: Facebook only. When the first slide is a video, Facebook's
   * Feed publish path only actually publishes that one slide - the Story
   * pick can diverge from what the Feed post shows. Instagram never passes
   * this, since Instagram's carousel publish keeps every slide. */
  showFeedDivergenceNotice?: boolean;
}

// KTD8: single-select variant of the thumbnail-grid-with-border-highlight
// pattern used elsewhere in the composer (third-party.media-library.tsx,
// media.box.tsx) - reused by both Instagram's and Facebook's settings
// panels rather than duplicated per provider.
export const StorySlidePicker: FC<StorySlidePickerProps> = (props) => {
  const { media, storyMediaId, onSelect, showFeedDivergenceNotice } = props;
  const t = useT();
  const mediaDirectory = useMediaDirectory();

  if (media.length <= 1) {
    return null;
  }

  const selectedId = storyMediaId ?? media[0]?.id;

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="text-[12px] opacity-70">
        {t(
          'story_slide_picker_label',
          'Which slide should appear in the Story?'
        )}
      </div>
      <div className="grid grid-cols-4 gap-[8px]">
        {media.map((item) => {
          const isSelected = item.id === selectedId;
          return (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="cursor-pointer aspect-square rounded-[6px] overflow-hidden relative"
            >
              <div
                className={clsx(
                  'w-full h-full border-[4px] rounded-[6px]',
                  isSelected ? 'border-[#612BD3]' : 'border-transparent'
                )}
              >
                {hasExtension(item.path, 'mp4') ? (
                  <VideoFrame
                    url={mediaDirectory.set(item.thumbnail || item.path)}
                  />
                ) : (
                  <img
                    className="w-full h-full object-cover rounded-[4px]"
                    src={mediaDirectory.set(item.thumbnail || item.path)}
                    alt=""
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {showFeedDivergenceNotice && (
        <div className="bg-tableBorder p-[10px] rounded-[10px] text-[12px] text-balance">
          {t(
            'story_slide_feed_divergence_notice',
            "Facebook will only actually publish the first slide to the Feed post since it's a video - the Story will still use whichever slide you pick here."
          )}
        </div>
      )}
    </div>
  );
};
