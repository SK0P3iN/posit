'use client';

import { FC, useRef } from 'react';
import Script from 'next/script';
import { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { useEmbedFallbackTimeout } from '@gitroom/frontend/components/inbox/embeds/embed.fallback.timeout.hook';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

declare global {
  interface Window {
    FB?: {
      init: (params: {
        appId: string;
        xfbml: boolean;
        version: string;
      }) => void;
      XFBML: {
        parse: (node?: HTMLElement | null) => void;
      };
    };
    fbAsyncInit?: () => void;
  }
}

const OpenLink: FC<{ remoteUrl?: string | null }> = ({ remoteUrl }) => {
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

export const FacebookEmbed: FC<{ item: InboxItem }> = ({ item }) => {
  const { facebookAppId } = useVariables();
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useEmbedFallbackTimeout(item.id, containerRef, () => {
    window.FB?.XFBML?.parse(containerRef.current);
  });

  // No app id configured server-side: don't attempt to load the SDK with an
  // empty appId, fall straight back to the link (R2/R4 behavior).
  if (!facebookAppId || status === 'failed') {
    return <OpenLink remoteUrl={item.remoteUrl} />;
  }

  return (
    <div>
      {/* The app doesn't render its own #fb-root anywhere else, so this
          widget owns it. Only one FacebookEmbed is ever mounted at a time
          (the detail pane shows a single selected item), so there's no
          duplicate-id risk. */}
      <div id="fb-root" />
      <Script
        id="facebook-jssdk"
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="lazyOnload"
        onLoad={() => {
          window.fbAsyncInit = () => {
            window.FB?.init({
              appId: facebookAppId,
              xfbml: true,
              version: 'v22.0',
            });
            window.FB?.XFBML?.parse(containerRef.current);
          };
          // If FB is already initialized by the time this script's onLoad
          // fires (e.g. re-mount after first load), parse directly too.
          if (window.FB) {
            window.FB.init({
              appId: facebookAppId,
              xfbml: true,
              version: 'v22.0',
            });
            window.FB.XFBML.parse(containerRef.current);
          }
        }}
      />
      <div ref={containerRef} className="max-w-[500px]">
        <div className="fb-post" data-href={item.remoteUrl || ''} />
      </div>
    </div>
  );
};
