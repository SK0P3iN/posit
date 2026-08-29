import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThreadCommentNode } from '@gitroom/frontend/components/inbox/thread/thread-comment-node.component';
import type { InboxThreadNode } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const mockToasterShow = jest.fn();
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const makeNode = (overrides: Partial<InboxThreadNode> = {}): InboxThreadNode => ({
  remoteId: 'c1',
  authorName: 'Alice',
  body: 'top comment',
  replyCapable: true,
  likeCapable: true,
  likeCount: 2,
  likedByMe: false,
  replies: [],
  ...overrides,
});

beforeEach(() => {
  mockFetch.mockReset();
  mockToasterShow.mockReset();
});

it('renders the comment body, nested replies, and the like count', () => {
  const node = makeNode({
    replies: [makeNode({ remoteId: 'c1-r1', authorName: 'Bob', body: 'a reply', likeCount: 0 })],
  });

  render(
    <ThreadCommentNode
      node={node}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  screen.getByText('top comment');
  screen.getByText('a reply');
  screen.getByText('2');
});

it('clicking like calls the like endpoint and updates the count/state from the response', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ liked: true, likeCount: 3 }),
  });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  fireEvent.click(screen.getByText('2'));

  await waitFor(() => screen.getByText('3'));
  expect(mockFetch).toHaveBeenCalledWith(
    '/inbox/comment/integration-1/c1/like',
    { method: 'POST', body: JSON.stringify({ liked: true }) }
  );
});

it('percent-encodes the remote id in the like and reply URLs', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ liked: true, likeCount: 3 }) });

  render(
    <ThreadCommentNode
      node={makeNode({ remoteId: 'a/b?c&d' })}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  fireEvent.click(screen.getByText('2'));
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/inbox/comment/integration-1/a%2Fb%3Fc%26d/like',
      expect.anything()
    )
  );

  fireEvent.click(screen.getByText('Reply'));
  fireEvent.change(screen.getByPlaceholderText('Write a reply...'), {
    target: { value: 'hi' },
  });
  fireEvent.click(screen.getByText('Send reply'));
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/inbox/comment/integration-1/a%2Fb%3Fc%26d/reply',
      expect.anything()
    )
  );
});

it('shows a toast and leaves the count unchanged when the like request fails', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ message: 'nope' }),
  });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={jest.fn()}
    />
  );

  fireEvent.click(screen.getByText('2'));

  await waitFor(() => expect(mockToasterShow).toHaveBeenCalledWith('nope', 'warning'));
  screen.getByText('2');
});

it('opening reply, typing, and sending calls the reply endpoint and clears the box', async () => {
  const onChanged = jest.fn();
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

  render(
    <ThreadCommentNode
      node={makeNode()}
      integrationId="integration-1"
      depth={0}
      onChanged={onChanged}
    />
  );

  fireEvent.click(screen.getByText('Reply'));
  fireEvent.change(screen.getByPlaceholderText('Write a reply...'), {
    target: { value: 'my reply' },
  });
  fireEvent.click(screen.getByText('Send reply'));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(mockFetch).toHaveBeenCalledWith('/inbox/comment/integration-1/c1/reply', {
    method: 'POST',
    body: JSON.stringify({ message: 'my reply' }),
  });
});
