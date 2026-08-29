'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { FieldValues, SubmitHandler, useForm } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const ANONYMOUS_COMMENT_LIMIT = 3;

const SendIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-send me-2 h-4 w-4"
  >
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const useComments = (postId: string) => {
  const fetch = useFetch();
  const loadComments = useCallback(async () => {
    return (await fetch(`/public/posts/${postId}/comments`)).json();
  }, [postId]);
  return useSWR('comments', loadComments);
};

const CommentsList: FC<{
  comments: any[];
}> = ({ comments }) => {
  const t = useT();
  const mapUsers = useMemo(() => {
    return comments.reduce(
      (all: any, current: any) => {
        if (current.userId) {
          all.users[current.userId] = all.users[current.userId] || all.counter++;
        }
        return all;
      },
      {
        users: {},
        counter: 1,
      }
    ).users;
  }, [comments]);

  if (!comments.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('comments', 'Comments')}</h3>
      {comments.map((comment: any) => (
        <div
          key={comment.id}
          className="flex space-x-3 border-t border-tableBorder py-3"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-semibold">
                {comment.userId
                  ? `${t('user', 'User')}${mapUsers[comment.userId]}`
                  : comment.authorName}
              </h3>
            </div>
            <p className="text-sm text-gray-300">{comment.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

const AuthedCommentForm: FC<{
  postId: string;
  onPosted: () => void;
}> = ({ postId, onPosted }) => {
  const fetch = useFetch();
  const t = useT();
  const { handleSubmit, register, setValue } = useForm();
  const submit: SubmitHandler<FieldValues> = useCallback(
    async (e) => {
      setValue('comment', '');
      await fetch(`/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(e),
      });
      onPosted();
    },
    [postId, onPosted]
  );

  return (
    <form className="flex-1 space-y-2" onSubmit={handleSubmit(submit)}>
      <textarea
        {...register('comment', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[98px] text-sm ring-offset-background placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-none text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder="Add a comment..."
        defaultValue={''}
      />
      <div className="flex justify-end">
        <Button type="submit">
          <SendIcon />
          {t('post', 'Post')}
        </Button>
      </div>
    </form>
  );
};

const AnonymousCommentForm: FC<{
  postId: string;
  onPosted: () => void;
  atLimit: boolean;
}> = ({ postId, onPosted, atLimit }) => {
  const fetch = useFetch();
  const t = useT();
  const [error, setError] = useState('');
  const { handleSubmit, register, setValue } = useForm();
  const submit: SubmitHandler<FieldValues> = useCallback(
    async (e) => {
      setError('');
      const response = await fetch(`/public/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(e),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          body?.message ||
            t(
              'comment_submission_failed',
              'Could not post your comment. Please try again.'
            )
        );
        return;
      }
      setValue('content', '');
      onPosted();
    },
    [postId, onPosted]
  );

  if (atLimit) {
    return (
      <p className="text-sm text-gray-400">
        {t(
          'review_comment_limit_reached',
          'This post has reached its review comment limit.'
        )}
      </p>
    );
  }

  return (
    <form className="flex-1 space-y-2" onSubmit={handleSubmit(submit)}>
      {!!error && <p className="text-sm text-red-400">{error}</p>}
      <input
        {...register('name', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[40px] text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder={t('your_name', 'Your name')}
        maxLength={100}
        defaultValue={''}
      />
      <textarea
        {...register('content', {
          required: true,
        })}
        className="flex w-full px-3 py-2 h-[98px] text-sm ring-offset-background placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-none text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0"
        placeholder={t('add_a_comment', 'Add a comment...')}
        maxLength={2000}
        defaultValue={''}
      />
      <div className="flex justify-end">
        <Button type="submit">
          <SendIcon />
          {t('post', 'Post')}
        </Button>
      </div>
    </form>
  );
};

export const CommentsComponents: FC<{
  postId: string;
}> = (props) => {
  const { postId } = props;
  const user = useUser();
  const { data, mutate, isLoading } = useComments(postId);

  if (isLoading || !data) {
    return null;
  }

  const comments = data.comments || [];
  const anonymousCount = comments.filter((c: any) => !c.userId).length;

  return (
    <>
      <div className="mb-6 flex space-x-3">
        {user?.id ? (
          <AuthedCommentForm postId={postId} onPosted={mutate} />
        ) : (
          <AnonymousCommentForm
            postId={postId}
            onPosted={mutate}
            atLimit={anonymousCount >= ANONYMOUS_COMMENT_LIMIT}
          />
        )}
      </div>
      <CommentsList comments={comments} />
    </>
  );
};
