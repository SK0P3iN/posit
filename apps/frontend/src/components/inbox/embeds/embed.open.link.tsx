'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const OpenLink: FC<{ remoteUrl?: string | null }> = ({
  remoteUrl,
}) => {
  const t = useT();
  if (!remoteUrl) {
    return null;
  }
  return (
    <a
      href={remoteUrl}
      target="_blank"
      rel="noreferrer"
      className="text-[13px] text-btnPrimary underline"
    >
      {t('open_on_platform', 'Open')}
    </a>
  );
};
