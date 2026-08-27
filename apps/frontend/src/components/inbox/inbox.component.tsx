'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  InboxChannelCapabilities,
  InboxItem,
  useInboxCapabilities,
  useInboxList,
  useInboxSyncStatus,
} from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { InboxEmbedProviders } from '@gitroom/frontend/components/inbox/embeds/embed.providers';
import { OpenLink } from '@gitroom/frontend/components/inbox/embeds/embed.open.link';

export const InboxComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [page, setPage] = useState(0);
  const [type, setType] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, mutate } = useInboxList({
    page,
    type: type || undefined,
    unreadOnly,
  });
  const { data: capabilities } = useInboxCapabilities();
  const { data: syncStatus, mutate: mutateSync } = useInboxSyncStatus();

  const items: InboxItem[] = data?.items || [];

  // Keep the open detail/reply pane in sync with the live list (e.g. a
  // KTD9 local cache patch or a real refetch) whenever the selected item is
  // still present in it, without ever clearing the pane just because a
  // filter/sync (R6) legitimately dropped the item out of `items` (R5/KTD8).
  useEffect(() => {
    setSelectedItem((current) => {
      if (!current) {
        return current;
      }
      const updated = items.find((item) => item.id === current.id);
      return updated || current;
    });
  }, [items]);

  const supportedChannels = useMemo(
    () =>
      (capabilities || []).filter(
        (c: InboxChannelCapabilities) => c.supported
      ),
    [capabilities]
  );
  const reconnectChannels = useMemo(
    () =>
      (capabilities || []).filter(
        (c: InboxChannelCapabilities) => c.refreshNeeded
      ),
    [capabilities]
  );

  const selectedCapability = useMemo(
    () =>
      (capabilities || []).find(
        (c: InboxChannelCapabilities) =>
          c.integrationId === selectedItem?.integration.id
      ),
    [capabilities, selectedItem]
  );
  const EmbedComponent = selectedItem
    ? InboxEmbedProviders[selectedItem.integration.providerIdentifier]
    : undefined;
  const canEmbed = !!(
    EmbedComponent &&
    selectedCapability?.embeddable &&
    selectedItem?.remoteUrl
  );

  useEffect(() => {
    if (!selectedId && items[0]?.id) {
      setSelectedId(items[0].id);
      setSelectedItem(items[0]);
    }
  }, [items, selectedId]);

  // `fetch`/`mutate` are re-bound to a new identity on every unrelated
  // filter/page/type change (a new `useInboxList` key means a new bound
  // `mutate`), so they can't sit in this effect's dependency array without
  // making a filter toggle re-fire the "mark read" call and re-patch the
  // cache mid-flight. Latest-ref indirection keeps the effect keyed only on
  // whether the *selected item itself* needs marking read, while still
  // calling through to the current fetch/mutate when it does fire.
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  // Guards the two local-patch call sites below (mark-read, reply) against
  // patching a key that hasn't finished its first load yet: SWR discards an
  // in-flight revalidation's result whenever *any* mutate() call — even a
  // no-op one, even with revalidate:false — overlaps it (this is intrinsic
  // to SWR's cache, not something the patch's return value controls). A
  // filter/page/type change can swap `mutate` (via the refs above) to a
  // brand-new key mid-flight, and calling mutate() before that key has any
  // data yet would strand it on `undefined` with nothing left to revalidate
  // it. There's nothing to patch in an empty cache anyway — the fetch that's
  // about to land already carries the correct server state for that key.
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (!selectedItem?.id || selectedItem.readAt) {
      return;
    }
    const id = selectedItem.id;
    fetchRef
      .current(`/inbox/${id}/read`, { method: 'PUT' })
      .then(() => {
        if (!dataRef.current) {
          return;
        }
        mutateRef.current(
          (currentData: any) =>
            currentData
              ? {
                  ...currentData,
                  items: currentData.items.map((i: InboxItem) =>
                    i.id === id
                      ? { ...i, readAt: new Date().toISOString() }
                      : i
                  ),
                }
              : currentData,
          false
        );
      })
      .catch(() => undefined);
  }, [selectedItem?.id, selectedItem?.readAt]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await (await fetch('/inbox/sync', { method: 'POST' })).json();
      await Promise.all([mutate(), mutateSync()]);
      if (result?.errors?.length) {
        toaster.show(
          t('inbox_sync_partial', 'Inbox sync finished with some channel errors'),
          'warning'
        );
      } else {
        toaster.show(t('inbox_sync_ok', 'Inbox synced'));
      }
    } catch {
      toaster.show(t('inbox_sync_failed', 'Inbox sync failed'), 'warning');
    } finally {
      setSyncing(false);
    }
  }, [fetch, mutate, mutateSync, toaster, t]);

  const sendReply = useCallback(async () => {
    if (!selectedItem?.id || !reply.trim()) {
      return;
    }
    const id = selectedItem.id;
    setSending(true);
    try {
      const response = await fetch(`/inbox/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: reply.trim() }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toaster.show(
          err?.message || t('inbox_reply_failed', 'Reply failed'),
          'warning'
        );
        return;
      }
      setReply('');
      toaster.show(t('inbox_reply_sent', 'Reply sent'));
      // Local cache patch (functional updater), not a revalidating refetch:
      // keeps the item in an active "unread only" list per R6/KTD9, and lets
      // this patch compose with a concurrent mark-read patch instead of
      // racing it with a stale snapshot. Guarded the same way as the
      // mark-read patch above (skip if this key has no data yet) so a
      // filter/page change mid-flight can't strand an in-flight fetch.
      if (dataRef.current) {
        mutate(
          (currentData: any) =>
            currentData
              ? {
                  ...currentData,
                  items: currentData.items.map((i: InboxItem) =>
                    i.id === id ? { ...i } : i
                  ),
                }
              : currentData,
          false
        );
      }
    } catch {
      toaster.show(t('inbox_reply_failed', 'Reply failed'), 'warning');
    } finally {
      setSending(false);
    }
  }, [selectedItem, reply, fetch, toaster, t, mutate]);

  return (
    <div className="flex flex-col gap-[16px] flex-1 min-h-0">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="text-[20px] font-[600] flex-1">
          {t('inbox', 'Inbox')}
        </div>
        <Button loading={syncing} onClick={syncNow}>
          {t('sync_now', 'Sync now')}
        </Button>
      </div>

      {reconnectChannels.length > 0 && (
        <div className="rounded-[8px] bg-amber-500/15 text-amber-300 px-[14px] py-[10px] text-[14px]">
          {t(
            'inbox_reconnect_banner',
            'Some channels need reconnect before inbox sync/reply works:'
          )}{' '}
          {reconnectChannels
            .map((c: InboxChannelCapabilities) => c.name)
            .join(', ')}
        </div>
      )}

      {syncStatus?.status === 'error' && syncStatus?.error && (
        <div className="rounded-[8px] bg-red-500/15 text-red-300 px-[14px] py-[10px] text-[14px]">
          {t('inbox_last_sync_error', 'Last sync error')}: {syncStatus.error}
        </div>
      )}

      <div className="flex gap-[8px] flex-wrap items-center">
        <select
          className="bg-newBgColorInner border border-newBorder rounded-[8px] h-[36px] px-[10px] text-[14px]"
          value={type}
          onChange={(e) => {
            setPage(0);
            setType(e.target.value);
          }}
        >
          <option value="">{t('all_types', 'All types')}</option>
          <option value="COMMENT">{t('comments', 'Comments')}</option>
          <option value="MENTION">{t('mentions', 'Mentions')}</option>
          <option value="DM">{t('dms', 'DMs')}</option>
        </select>
        <label className="flex items-center gap-[8px] text-[14px] cursor-pointer">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setPage(0);
              setUnreadOnly(e.target.checked);
            }}
          />
          {t('unread_only', 'Unread only')}
        </label>
      </div>

      <div className="flex flex-1 min-h-[520px] gap-[12px]">
        <div className="w-[360px] bg-newBgColorInner rounded-[12px] border border-newBorder overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-[16px] text-[14px] opacity-70">
                {t('loading', 'Loading...')}
              </div>
            )}
            {!isLoading && items.length === 0 && (
              <div className="p-[16px] text-[14px] opacity-70">
                {supportedChannels.length === 0
                  ? t(
                      'inbox_no_supported_channels',
                      'No connected channels support inbox yet. Connect Instagram, Facebook, X, or YouTube.'
                    )
                  : t(
                      'inbox_empty',
                      'No inbox items yet. Sync to pull comments and mentions.'
                    )}
              </div>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  setSelectedItem(item);
                }}
                className={clsx(
                  'w-full text-start px-[14px] py-[12px] border-b border-newBorder hover:bg-seventh/40',
                  selectedId === item.id && 'bg-seventh/60',
                  !item.readAt && 'font-[600]'
                )}
              >
                <div className="flex items-center gap-[8px] text-[12px] opacity-70 mb-[4px]">
                  <img
                    src={`/icons/platforms/${item.integration.providerIdentifier}.png`}
                    alt=""
                    className="w-[14px] h-[14px] rounded-[3px]"
                  />
                  <span>{item.integration.name}</span>
                  <span>·</span>
                  <span>{item.type}</span>
                </div>
                <div className="text-[14px] line-clamp-2">
                  {item.authorName ? `${item.authorName}: ` : ''}
                  {item.body || t('no_content', '(no content)')}
                </div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between p-[10px] border-t border-newBorder">
            <button
              type="button"
              disabled={page === 0}
              className="text-[13px] disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('previous', 'Previous')}
            </button>
            <span className="text-[12px] opacity-70">
              {t('page', 'Page')} {page + 1}
            </span>
            <button
              type="button"
              disabled={!data?.hasMore}
              className="text-[13px] disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
            >
              {t('next', 'Next')}
            </button>
          </div>
        </div>

        <div className="flex-1 bg-newBgColorInner rounded-[12px] border border-newBorder p-[16px] flex flex-col gap-[12px]">
          {!selectedItem && (
            <div className="opacity-70 text-[14px]">
              {t('select_inbox_item', 'Select an item to read and reply')}
            </div>
          )}
          {selectedItem && (
            <>
              <div className="flex items-start gap-[12px]">
                {selectedItem.authorPicture ? (
                  <img
                    src={selectedItem.authorPicture}
                    alt=""
                    className="w-[40px] h-[40px] rounded-full"
                  />
                ) : (
                  <div className="w-[40px] h-[40px] rounded-full bg-seventh" />
                )}
                <div className="flex-1">
                  <div className="font-[600]">
                    {selectedItem.authorName || t('unknown_author', 'Unknown')}
                  </div>
                  <div className="text-[12px] opacity-70">
                    {selectedItem.integration.name} · {selectedItem.type}
                    {selectedItem.remoteCreatedAt
                      ? ` · ${dayjs(selectedItem.remoteCreatedAt).format(
                          'MMM D, YYYY HH:mm'
                        )}`
                      : ''}
                  </div>
                </div>
                {canEmbed && EmbedComponent ? (
                  <EmbedComponent key={selectedItem.id} item={selectedItem} />
                ) : (
                  <OpenLink remoteUrl={selectedItem.remoteUrl} />
                )}
              </div>
              <div className="whitespace-pre-wrap text-[15px] leading-[22px] flex-1">
                {selectedItem.body}
              </div>
              {selectedItem.replyCapable ? (
                <div className="flex flex-col gap-[8px]">
                  <textarea
                    className="w-full min-h-[90px] rounded-[8px] bg-newBgColor border border-newBorder p-[12px] text-[14px]"
                    placeholder={t('write_a_reply', 'Write a reply...')}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      loading={sending}
                      disabled={!reply.trim()}
                      onClick={sendReply}
                    >
                      {t('send_reply', 'Send reply')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-[13px] opacity-70">
                  {t(
                    'inbox_reply_unavailable',
                    'Replies are not available for this item type on this channel.'
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
