'use client';

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type InboxItem = {
  id: string;
  type: 'COMMENT' | 'MENTION' | 'DM';
  remoteId: string;
  threadKey?: string | null;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  replyCapable: boolean;
  remoteUrl?: string | null;
  readAt?: string | null;
  remoteCreatedAt?: string | null;
  createdAt: string;
  integration: {
    id: string;
    name: string;
    picture?: string | null;
    providerIdentifier: string;
    refreshNeeded: boolean;
    disabled: boolean;
  };
};

export const useInboxList = (params: {
  page: number;
  type?: string;
  integrationId?: string;
  unreadOnly?: boolean;
}) => {
  const fetch = useFetch();
  const { page, type, integrationId, unreadOnly } = params;

  const key = useMemo(
    () =>
      `inbox-${page}-${type || 'all'}-${integrationId || 'all'}-${
        unreadOnly ? 'unread' : 'all'
      }`,
    [page, type, integrationId, unreadOnly]
  );

  const load = useCallback(async () => {
    const query = new URLSearchParams({
      page: String(page),
      limit: '20',
    });
    if (type) {
      query.set('type', type);
    }
    if (integrationId) {
      query.set('integrationId', integrationId);
    }
    if (unreadOnly) {
      query.set('unreadOnly', 'true');
    }
    return (await fetch(`/inbox?${query.toString()}`)).json();
  }, [fetch, page, type, integrationId, unreadOnly]);

  return useSWR(key, load);
};

export type InboxChannelCapabilities = {
  integrationId: string;
  name: string;
  providerIdentifier: string;
  refreshNeeded: boolean;
  comments: boolean;
  mentions: boolean;
  dms: boolean;
  embeddable: boolean;
  likes: boolean;
  supported: boolean;
};

export const useInboxCapabilities = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/inbox/capabilities')).json() as Promise<
      InboxChannelCapabilities[]
    >;
  }, [fetch]);
  return useSWR('inbox-capabilities', load, { revalidateOnFocus: false });
};

export const useInboxSyncStatus = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/inbox/sync-status')).json();
  }, [fetch]);
  return useSWR('inbox-sync-status', load, {
    refreshInterval: 60_000,
  });
};
