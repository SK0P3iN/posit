'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type InboxThreadNode = {
  remoteId: string;
  authorName?: string | null;
  authorId?: string | null;
  authorPicture?: string | null;
  body: string;
  remoteCreatedAt?: string | null;
  replyCapable: boolean;
  likeCapable: boolean;
  likeCount: number;
  likedByMe: boolean;
  replies: InboxThreadNode[];
};

export const useInboxThread = (
  integrationId: string | undefined,
  postRemoteId: string | undefined
) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (
      await fetch(
        `/inbox/thread/${integrationId}/${encodeURIComponent(
          postRemoteId as string
        )}`
      )
    ).json() as Promise<InboxThreadNode[]>;
  }, [fetch, integrationId, postRemoteId]);

  return useSWR(
    integrationId && postRemoteId
      ? `inbox-thread-${integrationId}-${postRemoteId}`
      : null,
    load
  );
};
