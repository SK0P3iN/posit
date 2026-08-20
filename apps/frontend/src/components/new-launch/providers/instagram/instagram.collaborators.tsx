'use client';

import { FC } from 'react';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { InstagramCollaboratorsTags } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.tags';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const graduationStrategies = [
  {
    value: 'MANUAL',
    label: 'Manual',
  },
  {
    value: 'SS_PERFORMANCE',
    label: 'Auto (based on performance)',
  },
];

// Collaborators apply to any non-Story post (InstagramProvider.postPending
// sends `collaborators` whenever `!isStory`, not only for Reels) - composed
// by instagram.provider.tsx wherever post_type isn't Story.
export const InstagramCollaboratorsTagsField: FC = () => {
  const t = useT();
  const { register } = useSettings();

  return (
    <InstagramCollaboratorsTags
      label={t(
        'instagram_collaborators_label',
        "Collaborators (max 3) - accounts can't be private"
      )}
      {...register('collaborators', {
        value: [],
      })}
    />
  );
};

// Reel-only fields (R1): Trial Reel toggle and its graduation strategy -
// Meta requires media_type=REELS for trial_params, so unlike collaborators
// these stay scoped to instagram.provider.tsx's Reel branch only.
export const InstagramTrialReelFields: FC = () => {
  const t = useT();
  const { watch, register } = useSettings();
  const isTrialReel = watch('is_trial_reel');

  return (
    <div className="flex flex-col gap-[18px]">
      <Checkbox
        {...register('is_trial_reel', {
          value: false,
        })}
        label={t(
          'trial_reel',
          'Trial Reel (share only to non-followers first)'
        )}
      />

      {isTrialReel && (
        <Select
          label={t('graduation_strategy', 'Graduation Strategy')}
          {...register('graduation_strategy', {
            value: 'MANUAL',
          })}
        >
          {graduationStrategies.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
};
