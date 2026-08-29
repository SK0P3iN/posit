import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { PostThreadModal } from '@gitroom/frontend/components/inbox/thread/post-thread.modal';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div>loading</div>,
}));

jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));

const renderModal = () =>
  render(
    <SWRConfig
      value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
    >
      <PostThreadModal integrationId="integration-1" postRemoteId="post-1" />
    </SWRConfig>
  );

beforeEach(() => {
  mockFetch.mockReset();
});

it('shows the error message instead of crashing when the thread request fails', async () => {
  // NestJS error body: truthy, but not an array — the pre-fix code fell
  // through to data.map() and threw at render time.
  mockFetch.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({
      statusCode: 400,
      message: 'Reconnect the channel before viewing inbox threads',
      error: 'Bad Request',
    }),
  });

  renderModal();

  await waitFor(() =>
    screen.getByText(
      'Could not load this thread. Try reconnecting the channel.'
    )
  );
});

it('shows the empty state when the thread comes back with no comments', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

  renderModal();

  await waitFor(() => screen.getByText('No comments yet on this post.'));
});

it('renders the thread nodes on a successful response', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [
      {
        remoteId: 'c1',
        authorName: 'Alice',
        body: 'top comment',
        replyCapable: true,
        likeCapable: true,
        likeCount: 1,
        likedByMe: false,
        replies: [],
      },
    ],
  });

  renderModal();

  await waitFor(() => screen.getByText('top comment'));
});
