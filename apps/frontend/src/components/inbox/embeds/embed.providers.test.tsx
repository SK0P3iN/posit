import React, { FC } from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  InboxChannelCapabilities,
  InboxItem,
} from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { InboxEmbedProviders } from '@gitroom/frontend/components/inbox/embeds/embed.providers';

// next/script only does real work in the browser; for these tests we just
// need it to invoke onLoad once mounted, like the SDK finished loading.
jest.mock('next/script', () => {
  return function MockScript(props: any) {
    React.useEffect(() => {
      props.onLoad?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  };
});

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

let mockFacebookAppId: string | undefined = 'test-app-id';
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ facebookAppId: mockFacebookAppId }),
}));

// Reproduces the exact gating logic from inbox.component.tsx (registry
// lookup + embeddable && remoteUrl check) without pulling in the whole
// InboxComponent (SWR/useFetch/toaster wiring), so these tests focus on the
// embed registry dispatch this unit adds.
const DetailPane: FC<{
  item: InboxItem;
  capabilities: InboxChannelCapabilities[];
}> = ({ item, capabilities }) => {
  const capability = capabilities.find(
    (c) => c.integrationId === item.integration.id
  );
  const EmbedComponent = InboxEmbedProviders[item.integration.providerIdentifier];
  const canEmbed = !!(EmbedComponent && capability?.embeddable && item.remoteUrl);

  return (
    <div>
      {canEmbed && EmbedComponent ? (
        <EmbedComponent key={item.id} item={item} />
      ) : (
        item.remoteUrl && (
          <a href={item.remoteUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        )
      )}
    </div>
  );
};

const makeItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'item-1',
  type: 'COMMENT',
  remoteId: 'remote-1',
  body: 'hello world',
  replyCapable: true,
  createdAt: new Date().toISOString(),
  remoteUrl: 'https://example.com/post/1',
  integration: {
    id: 'integration-1',
    name: 'My Channel',
    providerIdentifier: 'instagram',
    refreshNeeded: false,
    disabled: false,
  },
  ...overrides,
});

const makeCapability = (
  overrides: Partial<InboxChannelCapabilities> = {}
): InboxChannelCapabilities => ({
  integrationId: 'integration-1',
  name: 'My Channel',
  providerIdentifier: 'instagram',
  refreshNeeded: false,
  comments: true,
  mentions: true,
  dms: false,
  embeddable: true,
  supported: true,
  ...overrides,
});

describe('embed providers registry', () => {
  beforeEach(() => {
    mockFacebookAppId = 'test-app-id';
    // @ts-ignore
    delete window.instgrm;
    // @ts-ignore
    delete window.FB;
    // @ts-ignore
    delete window.twttr;
    // @ts-ignore
    delete window.YT;
  });

  it('renders the Instagram widget (not the link) for an embeddable item with a remoteUrl', () => {
    const item = makeItem({
      remoteUrl: 'https://www.instagram.com/p/abc123/',
      integration: {
        id: 'integration-1',
        name: 'Instagram',
        providerIdentifier: 'instagram',
        refreshNeeded: false,
        disabled: false,
      },
    });
    const { container } = render(
      <DetailPane item={item} capabilities={[makeCapability()]} />
    );

    expect(container.querySelector('blockquote.instagram-media')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('renders a YouTube player container referencing youtube-nocookie.com', () => {
    const playerSpy = jest.fn().mockImplementation(() => ({ destroy: jest.fn() }));
    // @ts-ignore
    window.YT = { Player: playerSpy };

    const item = makeItem({
      id: 'yt-item',
      remoteUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      integration: {
        id: 'integration-yt',
        name: 'YouTube',
        providerIdentifier: 'youtube',
        refreshNeeded: false,
        disabled: false,
      },
    });
    const capability = makeCapability({
      integrationId: 'integration-yt',
      providerIdentifier: 'youtube',
    });

    const { container } = render(
      <DetailPane item={item} capabilities={[capability]} />
    );

    expect(
      container.querySelector('#youtube-embed-yt-item')
    ).toBeTruthy();
    expect(playerSpy).toHaveBeenCalledWith(
      'youtube-embed-yt-item',
      expect.objectContaining({
        videoId: 'dQw4w9WgXcQ',
        host: 'https://www.youtube-nocookie.com',
      })
    );
  });

  it('renders nothing when the item has no remoteUrl (unchanged from today)', () => {
    const item = makeItem({ remoteUrl: null });
    const { container } = render(
      <DetailPane item={item} capabilities={[makeCapability()]} />
    );

    expect(container.querySelector('blockquote.instagram-media')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('renders the existing "Open" link when the channel is not embeddable', () => {
    const item = makeItem({
      remoteUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
      integration: {
        id: 'integration-li',
        name: 'LinkedIn',
        providerIdentifier: 'linkedin',
        refreshNeeded: false,
        disabled: false,
      },
    });
    const capability = makeCapability({
      integrationId: 'integration-li',
      providerIdentifier: 'linkedin',
      embeddable: false,
    });

    render(<DetailPane item={item} capabilities={[capability]} />);

    const link = screen.getByText('Open');
    expect(link.getAttribute('href')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:activity:1/'
    );
  });

  describe('fallback timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('swaps to the "Open" link when no embed renders within the timeout window', () => {
      // window.instgrm is left undefined, so the widget's start() call is a
      // no-op and the container's content never changes.
      const item = makeItem({
        remoteUrl: 'https://www.instagram.com/p/never-renders/',
      });

      render(<DetailPane item={item} capabilities={[makeCapability()]} />);

      expect(screen.queryByText('Open')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      const link = screen.getByText('Open');
      expect(link.getAttribute('href')).toBe(
        'https://www.instagram.com/p/never-renders/'
      );
    });

    it('does not apply a late-resolving result from a previously selected item to the newly selected one', async () => {
      // @ts-ignore
      window.instgrm = {
        Embeds: {
          process: jest.fn(() => {
            // Simulate an SDK that resolves asynchronously and mutates
            // whatever container it was handed when it was called — this
            // `target` (and the permalink used to mark it) is captured
            // fresh on every invocation (once for item A's mount, once
            // again for item B's), so a call made for A always mutates A's
            // own container, never whatever happens to be on screen later.
            const el = document.querySelector(
              '.instagram-media'
            ) as HTMLElement | null;
            const target = el?.parentElement || null;
            const permalink = el?.getAttribute('data-instgrm-permalink') || '';
            setTimeout(() => {
              if (target) {
                target.innerHTML = `<iframe title="processed" data-for="${permalink}" />`;
              }
            }, 2000);
          }),
        },
      };

      const itemA = makeItem({
        id: 'item-a',
        remoteUrl: 'https://www.instagram.com/p/item-a/',
      });
      const itemB = makeItem({
        id: 'item-b',
        remoteUrl: 'https://www.instagram.com/p/item-b/',
      });
      const capabilities = [makeCapability()];

      const { rerender, container } = render(
        <DetailPane item={itemA} capabilities={capabilities} />
      );

      // Switch to item B before A's delayed (t+2000ms) mutation fires.
      await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
      });
      rerender(<DetailPane item={itemB} capabilities={capabilities} />);

      // Advance past both A's stale mutation (fires at absolute t=2000) and
      // B's own (fires at absolute t=2500, i.e. 2000ms after its own mount
      // at t=500) — both timers are in flight at once, which is exactly the
      // race this guards against. The MutationObserver that flips B's status
      // to 'success' fires as a microtask, so the advance is awaited to let
      // it settle inside `act`.
      await act(async () => {
        jest.advanceTimersByTime(2500);
        await Promise.resolve();
      });

      // The pane that's actually on screen reflects only item B's own
      // processed content — item A's late callback mutated a node that was
      // already detached from the document by the time it fired, so it
      // never reaches the live tree.
      const processed = container.querySelector('iframe[title="processed"]');
      expect(processed).toBeTruthy();
      expect(processed?.getAttribute('data-for')).toBe(
        'https://www.instagram.com/p/item-b/'
      );
      expect(container.textContent || '').not.toContain('item-a');
    });
  });
});
