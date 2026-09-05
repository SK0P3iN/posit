'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MediaConsumer } from '@gitroom/frontend/components/media/use.media.hooks';

const consumerTypeLabel = (type: MediaConsumer['type']) => {
  switch (type) {
    case 'post':
      return 'Post';
    case 'user':
      return 'User';
    case 'oauth':
      return 'OAuth app';
    case 'agency':
      return 'Agency';
    default:
      return 'Item';
  }
};

export const MediaDeleteConfirmModal: FC<{
  count: number;
  consumers: MediaConsumer[];
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
}> = ({
  count,
  consumers,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
}) => {
  const t = useT();
  const preview = consumers.slice(0, 8);
  const remaining = consumers.length - preview.length;

  return (
    <div className="flex flex-col gap-[20px] text-textColor max-w-[520px]">
      <div className="text-[16px] font-[600]">
        {title ||
          t(
            'media_in_use_delete_title',
            'Some items are still in use'
          )}
      </div>
      <div className="text-[14px] text-newTextColor/80">
        {description ||
          t(
            'media_in_use_delete_description',
            '{{count}} consumer(s) still reference the selected media. Deleting will remove the media from the library and mark affected posts.',
            { count }
          )}
      </div>
      {consumers.length > 0 && (
        <div className="max-h-[240px] overflow-y-auto rounded-[8px] border border-newColColor bg-newBgColorInner">
          {preview.map((consumer, index) => (
            <div
              key={`${consumer.type}-${consumer.id}-${consumer.mediaId}-${index}`}
              className={clsx(
                'px-[14px] py-[10px] text-[13px] flex items-start gap-[10px]',
                index > 0 && 'border-t border-newColColor'
              )}
            >
              <span className="shrink-0 px-[8px] py-[2px] rounded-[6px] bg-newColColor text-[11px] font-[600] uppercase">
                {consumerTypeLabel(consumer.type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{consumer.label}</div>
                {consumer.state && (
                  <div className="text-[11px] text-newTextColor/60 mt-[2px]">
                    {consumer.state}
                  </div>
                )}
              </div>
            </div>
          ))}
          {remaining > 0 && (
            <div className="px-[14px] py-[10px] text-[12px] text-newTextColor/60 border-t border-newColColor">
              {t('and_n_more', 'and {{count}} more…', { count: remaining })}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-[8px]">
        <button
          onClick={onCancel}
          className="cursor-pointer h-[44px] px-[18px] rounded-[8px] border border-newTextColor/10"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          onClick={onConfirm}
          className="cursor-pointer h-[44px] px-[18px] rounded-[8px] bg-red-600 text-white"
        >
          {confirmLabel || t('delete_anyway', 'Delete anyway')}
        </button>
      </div>
    </div>
  );
};
