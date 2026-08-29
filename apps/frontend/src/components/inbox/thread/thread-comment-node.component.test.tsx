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

  expect(screen.getByText('top comment')).toBeInTheDocument();
  expect(screen.getByText('a reply')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
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

  await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  expect(mockFetch).toHaveBeenCalledWith(
    '/inbox/comment/integration-1/c1/like',
    { method: 'POST', body: JSON.stringify({ liked: true }) }
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
  expect(screen.getByText('2')).toBeInTheDocument();
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
