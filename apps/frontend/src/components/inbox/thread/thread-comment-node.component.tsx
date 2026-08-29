'use client';

import { FC, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import type { InboxThreadNode } from '@gitroom/frontend/components/inbox/thread/use.inbox.thread.hooks';

export const ThreadCommentNode: FC<{
  node: InboxThreadNode;
  integrationId: string;
  depth: number;
  onChanged: () => void;
}> = ({ node, integrationId, depth, onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [liking, setLiking] = useState(false);
  const [likedByMe, setLikedByMe] = useState(node.likedByMe);
  const [likeCount, setLikeCount] = useState(node.likeCount);
  const [replying, setReplying] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const toggleLike = async () => {
    setLiking(true);
    try {
      const nextLiked = !likedByMe;
      const response = await fetch(
        `/inbox/comment/${integrationId}/${node.remoteId}/like`,
        { method: 'POST', body: JSON.stringify({ liked: nextLiked }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toaster.show(
          err?.message || t('inbox_like_failed', 'Could not update like'),
          'warning'
        );
        return;
      }
      const result = await response.json();
      setLikedByMe(result.liked);
      setLikeCount(result.likeCount);
    } catch {
      toaster.show(t('inbox_like_failed', 'Could not update like'), 'warning');
    } finally {
      setLiking(false);
    }
  };

  const sendReply = async () => {
    if (!replyText.trim()) {
      return;
    }
    setReplying(true);
    try {
      const response = await fetch(
        `/inbox/comment/${integrationId}/${node.remoteId}/reply`,
        { method: 'POST', body: JSON.stringify({ message: replyText.trim() }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toaster.show(
          err?.message || t('inbox_reply_failed', 'Reply failed'),
          'warning'
        );
        return;
      }
      setReplyText('');
      setReplyOpen(false);
      toaster.show(t('inbox_reply_sent', 'Reply sent'));
      onChanged();
    } catch {
      toaster.show(t('inbox_reply_failed', 'Reply failed'), 'warning');
    } finally {
      setReplying(false);
    }
  };

  return (
    <div
      style={{ marginLeft: depth * 24 }}
      className="flex flex-col gap-[6px] py-[8px] border-b border-newBorder"
    >
      <div className="flex items-start gap-[8px]">
        {node.authorPicture ? (
          <img
            src={node.authorPicture}
            alt=""
            className="w-[28px] h-[28px] rounded-full"
          />
        ) : (
          <div className="w-[28px] h-[28px] rounded-full bg-seventh" />
        )}
        <div className="flex-1">
          <div className="text-[13px] font-[600]">
            {node.authorName || t('unknown_author', 'Unknown')}
            {node.remoteCreatedAt && (
              <span className="ml-[8px] text-[11px] opacity-60 font-normal">
                {dayjs(node.remoteCreatedAt).format('MMM D, YYYY HH:mm')}
              </span>
            )}
          </div>
          <div className="text-[14px] whitespace-pre-wrap">{node.body}</div>
          <div className="flex items-center gap-[12px] mt-[4px]">
            {node.likeCapable && (
              <button
                type="button"
                disabled={liking}
                onClick={toggleLike}
                className={clsx(
                  'text-[12px] flex items-center gap-[4px]',
                  likedByMe ? 'text-red-400' : 'opacity-70'
                )}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={likedByMe ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
                </svg>
                {likeCount}
              </button>
            )}
            {node.replyCapable && (
              <button
                type="button"
                className="text-[12px] opacity-70"
                onClick={() => setReplyOpen((open) => !open)}
              >
                {t('reply', 'Reply')}
              </button>
            )}
          </div>
          {replyOpen && (
            <div className="flex flex-col gap-[6px] mt-[6px]">
              <textarea
                className="w-full min-h-[60px] rounded-[8px] bg-newBgColor border border-newBorder p-[8px] text-[13px]"
                placeholder={t('write_a_reply', 'Write a reply...')}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  loading={replying}
                  disabled={!replyText.trim()}
                  onClick={sendReply}
                >
                  {t('send_reply', 'Send reply')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {node.replies.map((child) => (
        <ThreadCommentNode
          key={child.remoteId}
          node={child}
          integrationId={integrationId}
          depth={depth + 1}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
};
