'use client';

import { FC, useRef } from 'react';
import Script from 'next/script';
import { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { useEmbedFallbackTimeout } from '@gitroom/frontend/components/inbox/embeds/embed.fallback.timeout.hook';
import { OpenLink } from '@gitroom/frontend/components/inbox/embeds/embed.open.link';

declare global {
  interface Window {
    twttr?: {
      widgets: {
        load: (el?: HTMLElement | null) => void;
      };
    };
  }
}

export const XEmbed: FC<{ item: InboxItem }> = ({ item }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useEmbedFallbackTimeout(item.id, containerRef, () => {
    window.twttr?.widgets?.load(containerRef.current);
  });

  if (status === 'failed') {
    return <OpenLink remoteUrl={item.remoteUrl} />;
  }

  return (
    <div>
      <Script
        id="twitter-widgets-sdk"
        src="https://platform.twitter.com/widgets.js"
        strategy="lazyOnload"
        onLoad={() => window.twttr?.widgets?.load(containerRef.current)}
      />
      <div ref={containerRef} className="max-w-[420px]">
        <blockquote className="twitter-tweet">
          <a href={item.remoteUrl || ''}>{item.remoteUrl}</a>
        </blockquote>
      </div>
    </div>
  );
};
