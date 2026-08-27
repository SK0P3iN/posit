'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

export const InboxComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [page, setPage] = useState(0);
  const [type, setType] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const supportedChannels = useMemo(
    () => (capabilities || []).filter((c: any) => c.supported),
    [capabilities]
  );
  const reconnectChannels = useMemo(
    () => (capabilities || []).filter((c: any) => c.refreshNeeded),
    [capabilities]
  );

  const selectedCapability = useMemo(
    () =>
      (capabilities || []).find(
        (c: InboxChannelCapabilities) =>
          c.integrationId === selected?.integration.id
      ),
    [capabilities, selected]
  );
  const EmbedComponent = selected
    ? InboxEmbedProviders[selected.integration.providerIdentifier]
    : undefined;
  const canEmbed = !!(
    EmbedComponent &&
    selectedCapability?.embeddable &&
    selected?.remoteUrl
  );

  useEffect(() => {
    if (!selectedId && items[0]?.id) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!selected?.id || selected.readAt) {
      return;
    }
    fetch(`/inbox/${selected.id}/read`, { method: 'PUT' })
      .then(() => mutate())
      .catch(() => undefined);
  }, [selected?.id, selected?.readAt, fetch, mutate]);

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
    if (!selected?.id || !reply.trim()) {
      return;
    }
    setSending(true);
    try {
      const response = await fetch(`/inbox/${selected.id}/reply`, {
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
      mutate();
    } catch {
      toaster.show(t('inbox_reply_failed', 'Reply failed'), 'warning');
    } finally {
      setSending(false);
    }
  }, [selected, reply, fetch, toaster, t, mutate]);

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
          {reconnectChannels.map((c: any) => c.name).join(', ')}
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
                onClick={() => setSelectedId(item.id)}
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
          {!selected && (
            <div className="opacity-70 text-[14px]">
              {t('select_inbox_item', 'Select an item to read and reply')}
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-start gap-[12px]">
                {selected.authorPicture ? (
                  <img
                    src={selected.authorPicture}
                    alt=""
                    className="w-[40px] h-[40px] rounded-full"
                  />
                ) : (
                  <div className="w-[40px] h-[40px] rounded-full bg-seventh" />
                )}
                <div className="flex-1">
                  <div className="font-[600]">
                    {selected.authorName || t('unknown_author', 'Unknown')}
                  </div>
                  <div className="text-[12px] opacity-70">
                    {selected.integration.name} · {selected.type}
                    {selected.remoteCreatedAt
                      ? ` · ${dayjs(selected.remoteCreatedAt).format(
                          'MMM D, YYYY HH:mm'
                        )}`
                      : ''}
                  </div>
                </div>
                {canEmbed && EmbedComponent ? (
                  <EmbedComponent key={selected.id} item={selected} />
                ) : (
                  selected.remoteUrl && (
                    <a
                      href={selected.remoteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-btnPrimary underline"
                    >
                      {t('open_on_platform', 'Open')}
                    </a>
                  )
                )}
              </div>
              <div className="whitespace-pre-wrap text-[15px] leading-[22px] flex-1">
                {selected.body}
              </div>
              {selected.replyCapable ? (
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
