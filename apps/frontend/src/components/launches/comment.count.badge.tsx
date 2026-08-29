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
