'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MediaMissingBadge: FC<{
  variant?: 'calendar' | 'inline';
  className?: string;
}> = ({ variant = 'calendar', className }) => {
  const t = useT();

  if (variant === 'inline') {
    return (
      <div
        className={clsx(
          'inline-flex items-center gap-[6px] px-[10px] py-[6px] rounded-[8px] bg-amber-500/15 text-amber-400 text-[12px] font-[600]',
          className
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
        {t('media_missing', 'Media missing')}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'absolute -top-[6px] -right-[6px] z-20 flex items-center gap-[4px] px-[6px] h-[18px] rounded-full bg-amber-500 text-[10px] font-[700] text-black cursor-pointer',
        className
      )}
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'media_missing_tooltip',
        'This post references media that was deleted from the library'
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
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 12h8" />
      </svg>
      <span>{t('media_missing_short', 'Media')}</span>
    </div>
  );
};

export const mediaMissingRingClass = 'rounded-[10px] ring-2 ring-amber-500';
