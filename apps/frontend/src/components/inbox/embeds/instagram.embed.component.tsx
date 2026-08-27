'use client';

import { FC, useRef } from 'react';
import Script from 'next/script';
import { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { useEmbedFallbackTimeout } from '@gitroom/frontend/components/inbox/embeds/embed.fallback.timeout.hook';
import { OpenLink } from '@gitroom/frontend/components/inbox/embeds/embed.open.link';

declare global {
  interface Window {
    instgrm?: {
      Embeds: {
        // Optional element scopes the scan to one container instead of
        // rescanning the whole document on every item switch.
        process: (element?: HTMLElement) => void;
      };
    };
  }
}

export const InstagramEmbed: FC<{ item: InboxItem }> = ({ item }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useEmbedFallbackTimeout(item.id, containerRef, () => {
    window.instgrm?.Embeds?.process(containerRef.current || undefined);
  });

  if (status === 'failed') {
    return <OpenLink remoteUrl={item.remoteUrl} />;
  }

  return (
    <div>
      <Script
        id="instagram-embed-sdk"
        src="https://www.instagram.com/embed.js"
        strategy="lazyOnload"
        onLoad={() =>
          window.instgrm?.Embeds?.process(containerRef.current || undefined)
        }
      />
      <div ref={containerRef} className="max-w-[420px]">
        <blockquote
          className="instagram-media"
          data-instgrm-permalink={item.remoteUrl || ''}
          data-instgrm-version="14"
        />
      </div>
    </div>
  );
};
