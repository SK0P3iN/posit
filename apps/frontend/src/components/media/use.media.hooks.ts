'use client';

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type MediaFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
};

export type MediaConsumer = {
  mediaId: string;
  type: 'post' | 'user' | 'oauth' | 'agency';
  id: string;
  label: string;
  state?: string;
};

export type DeleteWarningResponse = {
  requiresConfirm: boolean;
  count: number;
  consumers: MediaConsumer[];
  inUse?: boolean;
};

export const useMediaList = (params: {
  page: number;
  search: string;
  folderId?: string | null;
  unfiled?: boolean;
  usage?: 'unused' | 'detached';
  enabled?: boolean;
}) => {
  const fetch = useFetch();
  const { page, search, folderId, unfiled, usage, enabled = true } = params;

  const key = useMemo(
    () =>
      enabled
        ? `media-list-${page}-${search}-${folderId ?? ''}-${unfiled ?? false}-${
            usage ?? ''
          }`
        : null,
    [page, search, folderId, unfiled, usage, enabled]
  );

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page + 1) });
    if (search.trim()) {
      query.set('search', search.trim());
    }
    if (unfiled) {
      query.set('unfiled', 'true');
    } else if (folderId) {
      query.set('folderId', folderId);
    }
    if (usage) {
      query.set('usage', usage);
    }
    return (await fetch(`/media?${query.toString()}`)).json();
  }, [fetch, page, search, folderId, unfiled, usage]);

  return useSWR(key, load);
};

export const useMediaFolders = (enabled = true) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/media/folders')).json();
  }, [fetch]);

  return useSWR(enabled ? 'media-folders' : null, load, {
    revalidateOnFocus: false,
  });
};

export const useMediaTrash = (page: number, enabled = true) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch(`/media/trash?page=${page + 1}`)).json();
  }, [fetch, page]);

  return useSWR(enabled ? `media-trash-${page}` : null, load);
};

export const useMediaFoldersTrash = (enabled = true) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/media/folders/trash')).json();
  }, [fetch]);

  return useSWR(enabled ? 'media-folders-trash' : null, load, {
    revalidateOnFocus: false,
  });
};
