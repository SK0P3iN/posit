'use client';

import { FC, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { OpenLink } from '@gitroom/frontend/components/inbox/embeds/embed.open.link';

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          host?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => { destroy: () => void; getIframe: () => HTMLIFrameElement };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Documented IFrame Player API onError codes for a request that can never
// succeed (private/deleted/embedding-disabled/not-found video): swap to the
// external link instead of leaving a broken player mounted.
// https://developers.google.com/youtube/iframe_api_reference#onError
const FATAL_ERROR_CODES = new Set([2, 5, 100, 101, 150, 153]);

const extractVideoId = (remoteUrl: string): string | null => {
  try {
    const url = new URL(remoteUrl);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace(/^\//, '') || null;
    }
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/')[2] || null;
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/')[2] || null;
    }
    return url.searchParams.get('v');
  } catch {
    return null;
  }
};

export const YoutubeEmbed: FC<{ item: InboxItem }> = ({ item }) => {
  const containerId = `youtube-embed-${item.id}`;
  const playerRef = useRef<{
    destroy: () => void;
    getIframe: () => HTMLIFrameElement;
  } | null>(null);
  const itemIdRef = useRef(item.id);
  const [failed, setFailed] = useState(false);

  const videoId = item.remoteUrl ? extractVideoId(item.remoteUrl) : null;

  useEffect(() => {
    itemIdRef.current = item.id;
    setFailed(false);

    if (!videoId) {
      return;
    }

    const initPlayer = () => {
      if (!window.YT?.Player) {
        return;
      }
      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        // youtube-nocookie.com host avoids the 2025+ referrer-check
        // failure (error code 153) for embeds outside youtube.com.
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            // The Player API's generated iframe has no referrerPolicy
            // option on the constructor; set it directly on the iframe it
            // creates (KTD6) to avoid the 2025+ referrer-check failure
            // (error code 153) under a strict default referrer policy.
            try {
              playerRef.current
                ?.getIframe?.()
                ?.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            } catch {
              // Best-effort: absence of getIframe() on an older API surface
              // should not break playback.
            }
          },
          onError: (event) => {
            // Stale-selection guard (KTD7): discard a callback that
            // resolves after the user has already moved to another item.
            if (itemIdRef.current !== item.id) {
              return;
            }
            if (FATAL_ERROR_CODES.has(event.data)) {
              setFailed(true);
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      // Only one YoutubeEmbed is ever mounted at a time (the detail pane
      // shows a single selected item), so this handler is replaced, not
      // chained, per item switch — chaining would let a stale item's
      // initPlayer() still run (against an already-unmounted container)
      // once the API script finally loads.
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (window.onYouTubeIframeAPIReady === initPlayer) {
        window.onYouTubeIframeAPIReady = undefined;
      }
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, videoId]);

  if (!videoId || failed) {
    return <OpenLink remoteUrl={item.remoteUrl} />;
  }

  return (
    <div>
      <Script src="https://www.youtube.com/iframe_api" strategy="lazyOnload" />
      <div
        id={containerId}
        data-testid="youtube-embed-container"
        className="w-full max-w-[480px] aspect-video"
      />
    </div>
  );
};
