import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { InboxComponent } from '@gitroom/frontend/components/inbox/inbox.component';
import type { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';

// U4 regression suite for `apps/frontend/src/components/inbox/inbox.component.tsx`:
// marking an item read (or replying to it) must never evict it from the
// currently displayed "unread only" list, and must never close its open
// detail/reply pane (R5). The item only drops out of a filtered list on the
// next explicit refresh — a filter change or a sync (R6).
//
// `useT` is mocked to just return the fallback string (same as
// embed.providers.test.tsx). `useInboxList` / `useInboxCapabilities` /
// `useInboxSyncStatus` are exercised for real (they're thin `useSWR`
// wrappers around `useFetch`), driven by a mocked `useFetch` that stands in
// for the backend. This lets the test observe SWR's actual cache/mutate
// semantics instead of re-implementing them.

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

type ServerItem = InboxItem;

const makeItem = (overrides: Partial<ServerItem> = {}): ServerItem => ({
  id: 'item-1',
  type: 'COMMENT',
  remoteId: 'remote-1',
  authorName: 'Author',
  body: 'body',
  replyCapable: true,
  createdAt: new Date().toISOString(),
  remoteUrl: 'https://example.com/post/1',
  readAt: null,
  // 'linkedin' has no entry in InboxEmbedProviders, so the detail pane
  // always renders the plain OpenLink fallback — this suite is about the
  // mark-read/reply eviction behavior (U4), not the U3 embed dispatch.
  integration: {
    id: 'integration-1',
    name: 'My Channel',
    providerIdentifier: 'linkedin',
    refreshNeeded: false,
    disabled: false,
  },
  ...overrides,
});

// The list renders `{authorName}: ` and `{body}` as adjacent text inside the
// same `.line-clamp-2` div, so RTL's exact-text matching against a bare
// "Body N" string only ever hits the (unrelated) detail-pane body div, never
// the list row. These helpers query the list rows directly instead.
const getRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.line-clamp-2')) as HTMLElement[];

const findRowByBody = (container: HTMLElement, body: string) =>
  getRows(container).find((row) => (row.textContent || '').includes(body));

// Gates that let a test hold a specific backend call unresolved on demand,
// to interleave two concurrent writers (mark-read + reply) deterministically.
let readGate: Promise<void> = Promise.resolve();
let replyGate: Promise<void> = Promise.resolve();

let serverItems: ServerItem[] = [];

const okJson = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

const installFetchMock = () => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, options: any = {}) => {
    const method = options.method || 'GET';

    if (url.startsWith('/inbox?')) {
      const query = new URLSearchParams(url.split('?')[1]);
      const unreadOnly = query.get('unreadOnly') === 'true';
      const items = unreadOnly
        ? serverItems.filter((i) => !i.readAt)
        : serverItems.slice();
      return okJson({
        items,
        total: items.length,
        page: 0,
        limit: 20,
        hasMore: false,
      });
    }
    if (url === '/inbox/capabilities') {
      return okJson([]);
    }
    if (url === '/inbox/sync-status') {
      return okJson({ status: 'ok' });
    }
    const readMatch = url.match(/^\/inbox\/([^/]+)\/read$/);
    if (readMatch && method === 'PUT') {
      await readGate;
      const item = serverItems.find((i) => i.id === readMatch[1]);
      if (item) {
        item.readAt = new Date().toISOString();
      }
      return okJson({});
    }
    const replyMatch = url.match(/^\/inbox\/([^/]+)\/reply$/);
    if (replyMatch && method === 'POST') {
      await replyGate;
      return okJson({});
    }
    if (url === '/inbox/sync' && method === 'POST') {
      return okJson({ errors: [] });
    }
    throw new Error(`Unhandled mock fetch: ${method} ${url}`);
  });
};

const renderInbox = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InboxComponent />
    </SWRConfig>
  );

beforeEach(() => {
  readGate = Promise.resolve();
  replyGate = Promise.resolve();
  installFetchMock();
});

describe('InboxComponent unread-only eviction (U4)', () => {
  it('keeps all items visible and the clicked item selected+open after it is marked read', async () => {
    serverItems = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `item-${i + 1}`,
        authorName: `Author ${i + 1}`,
        body: `Body ${i + 1}`,
      })
    );

    const { container } = renderInbox();

    // Turn "unread only" on.
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() => expect(getRows(container)).toHaveLength(5));

    // Click item #3.
    const row3 = findRowByBody(container, 'Body 3');
    expect(row3).toBeTruthy();
    fireEvent.click(row3!.closest('button')!);

    // Detail pane shows item #3 immediately (selectedItem set at click time).
    // `getByText` itself throws when no match exists, so a non-throwing
    // callback is the presence assertion (no `@testing-library/jest-dom`
    // matcher like `toBeInTheDocument` is installed in this repo).
    await waitFor(() => screen.getByText('Author 3'));

    // Wait for the mark-read PUT to resolve and the local cache patch to apply.
    await waitFor(() => expect(serverItems[2].readAt).toBeTruthy());
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/inbox/item-3/read',
        expect.objectContaining({ method: 'PUT' })
      )
    );

    // All 5 items are still visible (not evicted from the active unread-only list).
    expect(getRows(container)).toHaveLength(5);
    // The pane is still open on item #3.
    screen.getByText('Author 3');
  });

  it('drops the now-read item from the list only on the next explicit filter refresh', async () => {
    serverItems = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        id: `item-${i + 1}`,
        authorName: `Author ${i + 1}`,
        body: `Body ${i + 1}`,
      })
    );

    const { container } = renderInbox();

    // The component auto-selects the first item on load (pre-existing
    // behavior, independent of U4), which also marks item-1 read via the
    // same mark-read effect this test exercises for item-2 below. Wait for
    // that to settle first so the rest of this test is deterministic.
    await waitFor(() => expect(serverItems[0].readAt).toBeTruthy());

    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox); // unread only on
    await waitFor(() => expect(getRows(container)).toHaveLength(2));

    const row2 = findRowByBody(container, 'Body 2');
    fireEvent.click(row2!.closest('button')!);
    await waitFor(() => expect(serverItems[1].readAt).toBeTruthy());
    // Still present right after mark-read (R5).
    expect(getRows(container)).toHaveLength(2);

    // Toggle the filter off then back on -> forces a fresh fetch (R6).
    fireEvent.click(checkbox); // unread only off
    await waitFor(() => expect(getRows(container)).toHaveLength(3));
    fireEvent.click(checkbox); // unread only on again
    await waitFor(() => expect(getRows(container)).toHaveLength(1));

    expect(findRowByBody(container, 'Body 2')).toBeUndefined();
  });

  it('does not remove the selected item from the list after sending a reply to it', async () => {
    serverItems = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `item-${i + 1}`,
        authorName: `Author ${i + 1}`,
        body: `Body ${i + 1}`,
        readAt: i === 0 ? new Date().toISOString() : null, // item-1 already read
      })
    );

    const { container } = renderInbox();

    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() => expect(getRows(container)).toHaveLength(3));

    const row2 = findRowByBody(container, 'Body 2');
    fireEvent.click(row2!.closest('button')!);
    await waitFor(() => expect(serverItems[1].readAt).toBeTruthy());

    const textarea = screen.getByPlaceholderText('Write a reply...');
    fireEvent.change(textarea, { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByText('Send reply'));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/inbox/item-2/reply',
        expect.objectContaining({ method: 'POST' })
      )
    );
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(''));

    // Item #2 is still in the unread-only list and still selected/open.
    expect(getRows(container)).toHaveLength(3);
    screen.getByText('Author 2');
  });

  it('applies both a mark-read patch and a reply patch when they resolve out of order, without either being lost', async () => {
    serverItems = [
      makeItem({ id: 'item-1', authorName: 'Author 1', body: 'Body 1' }),
    ];

    let releaseRead: () => void = () => undefined;
    let releaseReply: () => void = () => undefined;
    readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    replyGate = new Promise((resolve) => {
      releaseReply = resolve;
    });

    const { container } = renderInbox();

    await waitFor(() => expect(getRows(container)).toHaveLength(1));
    // Item auto-selects on load (first item) -> mark-read PUT fires and is
    // now held open on `readGate`.
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/inbox/item-1/read',
        expect.objectContaining({ method: 'PUT' })
      )
    );

    // Fire a reply while the mark-read PUT is still in flight.
    const textarea = screen.getByPlaceholderText('Write a reply...');
    fireEvent.change(textarea, { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/inbox/item-1/reply',
        expect.objectContaining({ method: 'POST' })
      )
    );

    // Resolve the reply first, then the mark-read — the later writer must
    // not clobber the earlier writer's patch (this is exactly what the
    // functional-updater `mutate((current) => ..., false)` form guarantees;
    // a closure-snapshot `mutate(staleObject, false)` would lose it here).
    await act(async () => {
      releaseReply();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      releaseRead();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The list row is no longer bold (`!item.readAt && 'font-[600]'`), which
    // only happens once the mark-read patch has landed in the SWR cache —
    // proving the reply patch (applied afterwards, or before) did not
    // revert it via a stale snapshot.
    await waitFor(() => {
      const row = findRowByBody(container, 'Body 1');
      const rowButton = row?.closest('button');
      expect(rowButton?.className).not.toContain('font-[600]');
    });
  });

  it('leaves the open pane intact when a sync drops the selected item from the list', async () => {
    serverItems = [
      makeItem({ id: 'item-1', authorName: 'Author 1', body: 'Body 1' }),
      makeItem({ id: 'item-2', authorName: 'Author 2', body: 'Body 2' }),
    ];

    const { container } = renderInbox();

    await waitFor(() => expect(getRows(container)).toHaveLength(2));
    const row1 = findRowByBody(container, 'Body 1');
    fireEvent.click(row1!.closest('button')!);
    await waitFor(() => screen.getByText('Author 1'));
    await waitFor(() => expect(serverItems[0].readAt).toBeTruthy());

    // Simulate a sync that causes the server to stop returning item-1 (e.g.
    // it fell out of the synced window).
    serverItems = serverItems.filter((i) => i.id !== 'item-1');

    fireEvent.click(screen.getByText('Sync now'));

    await waitFor(() =>
      expect(findRowByBody(container, 'Body 1')).toBeUndefined()
    );
    // Only the list lost the row — the open pane still shows item-1.
    screen.getByText('Author 1');
    expect(findRowByBody(container, 'Body 2')).toBeTruthy();
  });
});
