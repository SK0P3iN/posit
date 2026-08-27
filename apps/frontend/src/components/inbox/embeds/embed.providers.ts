import { ComponentType } from 'react';
import { InboxItem } from '@gitroom/frontend/components/inbox/use.inbox.hooks';
import { InstagramEmbed } from '@gitroom/frontend/components/inbox/embeds/instagram.embed.component';
import { FacebookEmbed } from '@gitroom/frontend/components/inbox/embeds/facebook.embed.component';
import { XEmbed } from '@gitroom/frontend/components/inbox/embeds/x.embed.component';
import { YoutubeEmbed } from '@gitroom/frontend/components/inbox/embeds/youtube.embed.component';

export type InboxEmbedProps = {
  item: InboxItem;
};

// providerIdentifier -> native embed widget, mirroring the
// {identifier, component} dispatch in
// apps/frontend/src/components/new-launch/providers/show.all.providers.tsx
export const InboxEmbedProviders: Record<
  string,
  ComponentType<InboxEmbedProps>
> = {
  instagram: InstagramEmbed,
  'instagram-standalone': InstagramEmbed,
  facebook: FacebookEmbed,
  x: XEmbed,
  youtube: YoutubeEmbed,
};
