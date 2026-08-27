import { RefObject, useEffect, useRef, useState } from 'react';

export type EmbedFallbackStatus = 'pending' | 'success' | 'failed';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Shared fallback for third-party embed widgets (Instagram/Facebook/X) that
 * don't expose a reliable error callback: call `start` (the platform's
 * process/parse/load function) and watch `containerRef` for its content to
 * change from the static placeholder markup each widget renders (e.g. an
 * unprocessed `blockquote.instagram-media`) into the SDK's real embed. If
 * nothing changes within `timeoutMs`, resolve to 'failed' so the caller can
 * swap to the plain "Open" link instead.
 *
 * The container is diffed by content (not just "has a child") because these
 * SDKs render in place — e.g. Instagram swaps the placeholder blockquote for
 * an iframe rather than appending alongside it — so a plain child-presence
 * check would report "success" immediately, before the SDK ever ran, since
 * the placeholder itself is already a child at mount.
 *
 * Mirrors the ref-plus-cleanup shape of `useHasScroll`
 * (apps/frontend/src/components/ui/is.scroll.hook.tsx): a MutationObserver
 * watches the DOM, and both the observer and the timeout timer are torn down
 * on effect cleanup so switching items never accumulates stale timers.
 *
 * `itemId` is captured in a ref and re-checked before applying a late
 * resolution, so a result that resolves after the user has already moved on
 * to a different inbox item is discarded even if some part of the mutation
 * still reaches this (now stale) closure.
 */
export function useEmbedFallbackTimeout(
  itemId: string,
  containerRef: RefObject<HTMLElement | null>,
  start: () => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): EmbedFallbackStatus {
  const [status, setStatus] = useState<EmbedFallbackStatus>('pending');
  const itemIdRef = useRef(itemId);

  useEffect(() => {
    itemIdRef.current = itemId;
    setStatus('pending');

    const el = containerRef.current;
    if (!el) {
      setStatus('failed');
      return;
    }

    let settled = false;
    const resolve = (next: EmbedFallbackStatus) => {
      if (settled || itemIdRef.current !== itemId) {
        return;
      }
      settled = true;
      setStatus(next);
    };

    const baselineHTML = el.innerHTML;
    const check = () => {
      if (el.innerHTML !== baselineHTML) {
        resolve('success');
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    start();
    check();

    const timer = setTimeout(() => resolve('failed'), timeoutMs);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return status;
}
