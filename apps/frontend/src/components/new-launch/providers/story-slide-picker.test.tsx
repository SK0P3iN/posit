import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StorySlidePicker } from '@gitroom/frontend/components/new-launch/providers/story-slide-picker';

// U3 coverage: default selection, click-to-select, and the KTD8
// Facebook-only divergence notice. Toggle-off/on persistence (KD8) is
// exercised at the caller level (instagram.provider.tsx passes whatever
// story_media_id it already holds - this component never clears it), so
// it isn't re-tested here; this suite covers the picker's own contract.
//
// No `@testing-library/jest-dom` matcher (`toBeInTheDocument`, etc.) is
// installed in this repo (see inbox.component.test.tsx) - presence is
// asserted via `getByText`/`querySelector` throwing or returning null.
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => <div data-testid="video-frame" />,
}));

const media = [
  { id: 'media-1', path: 'https://cdn/img1.png' },
  { id: 'media-2', path: 'https://cdn/img2.png' },
  { id: 'media-3', path: 'https://cdn/img3.mp4' },
];

describe('StorySlidePicker (U3)', () => {
  it('does not render for a single media item', () => {
    const { container } = render(
      <StorySlidePicker media={[media[0]]} onSelect={jest.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('defaults the first slide as selected when no storyMediaId is given', () => {
    const { container } = render(
      <StorySlidePicker media={media} onSelect={jest.fn()} />
    );
    const images = container.querySelectorAll('img');
    // media-1's <img> sits inside the bordered wrapper carrying the selected class.
    expect(images[0].parentElement?.className).toContain('border-[#612BD3]');
    expect(images[1].parentElement?.className).toContain('border-transparent');
  });

  it('highlights the slide named by storyMediaId instead of the first', () => {
    const { container } = render(
      <StorySlidePicker
        media={media}
        storyMediaId="media-2"
        onSelect={jest.fn()}
      />
    );
    const images = container.querySelectorAll('img');
    expect(images[0].parentElement?.className).toContain('border-transparent');
    expect(images[1].parentElement?.className).toContain('border-[#612BD3]');
  });

  it('calls onSelect with the clicked slide id', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <StorySlidePicker media={media} storyMediaId="media-1" onSelect={onSelect} />
    );
    const images = container.querySelectorAll('img');
    // img -> bordered div -> outer clickable div (the one with onClick).
    fireEvent.click(images[1].parentElement!.parentElement!);
    expect(onSelect).toHaveBeenCalledWith('media-2');
  });

  it('renders the Facebook divergence notice only when asked', () => {
    const { rerender, container } = render(
      <StorySlidePicker media={media} onSelect={jest.fn()} />
    );
    expect(
      screen.queryByText(/will only actually publish the first slide/i)
    ).toBeNull();

    rerender(
      <StorySlidePicker
        media={media}
        onSelect={jest.fn()}
        showFeedDivergenceNotice
      />
    );
    screen.getByText(/will only actually publish the first slide/i);
  });
});
