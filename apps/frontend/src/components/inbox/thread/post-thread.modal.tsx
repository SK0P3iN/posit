'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useInboxThread } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';
import { ThreadCommentNode } from '@gitroom/frontend/components/inbox/thread/thread-comment-node.component';

export const PostThreadModal: FC<{
  integrationId: string;
  postRemoteId: string;
}> = ({ integrationId, postRemoteId }) => {
  const t = useT();
  const { data, isLoading, mutate } = useInboxThread(integrationId, postRemoteId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[40px]">
        <LoadingComponent />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center text-textColor py-[20px] text-[14px]">
        {t('inbox_thread_empty', 'No comments yet on this post.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[70vh] overflow-y-auto">
      {data.map((node) => (
        <ThreadCommentNode
          key={node.remoteId}
          node={node}
          integrationId={integrationId}
          depth={0}
          onChanged={() => mutate()}
        />
      ))}
    </div>
  );
};
