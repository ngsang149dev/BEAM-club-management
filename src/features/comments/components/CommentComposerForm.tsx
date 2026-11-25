'use client';

import { useId } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import { TaskErrorBanner } from '@/features/tasks/components/TaskFormFields';
import {
  COMMENT_BODY_MAX,
  createCommentRequestSchema,
  type CreateCommentRequestInput,
} from '@/lib/comments';

const COMMENT_NEAR_LIMIT = 3600;

function ComposerCounterFooter({
  bodyLength,
  isPending,
}: {
  readonly bodyLength: number;
  readonly isPending: boolean;
}) {
  const tComments = useTranslations('comments');
  const isNearLimit = bodyLength >= COMMENT_NEAR_LIMIT;
  const isOverLimit = bodyLength > COMMENT_BODY_MAX;
  const counterClass = isOverLimit
    ? 'task-comment-counter is-over'
    : isNearLimit
      ? 'task-comment-counter is-near'
      : 'task-comment-counter';

  return (
    <div className="task-comment-composer-foot">
      <span className={counterClass}>
        {isNearLimit
          ? tComments('charLimitNear', { count: bodyLength, max: COMMENT_BODY_MAX })
          : tComments('charCount', { count: bodyLength, max: COMMENT_BODY_MAX })}
      </span>
      <button type="submit" className="ui-btn primary is-sm" disabled={isPending}>
        {isPending ? tComments('submitting') : tComments('submit')}
      </button>
    </div>
  );
}

export function CommentComposerForm({
  isPending,
  apiError,
  onSubmitBody,
}: {
  readonly isPending: boolean;
  readonly apiError: unknown;
  readonly onSubmitBody: (body: string, resetForm: () => void) => void;
}) {
  const tComments = useTranslations('comments');
  const inputId = useId();
  const { register, control, reset, handleSubmit, formState: { errors } } =
    useForm<CreateCommentRequestInput>({
      resolver: zodResolver(createCommentRequestSchema),
      defaultValues: { body: '' },
    });
  const bodyLength = useWatch({ control, name: 'body', defaultValue: '' }).length;

  return (
    <form
      className="task-comment-composer"
      method="post"
      onSubmit={handleSubmit((values) => onSubmitBody(values.body, () => reset({ body: '' })))}
      noValidate
    >
      <TaskErrorBanner error={apiError} />
      <div className="ui-field">
        <label className="ui-label" htmlFor={inputId}>{tComments('composerLabel')}</label>
        <textarea
          id={inputId}
          className="ui-textarea"
          rows={3}
          placeholder={tComments('composerPlaceholder')}
          disabled={isPending}
          aria-invalid={Boolean(errors.body)}
          {...register('body')}
        />
        {errors.body ? (
          <p className="ui-field-error" role="alert">
            {bodyLength > COMMENT_BODY_MAX
              ? tComments('validationTooLong', { max: COMMENT_BODY_MAX })
              : tComments('validationRequired')}
          </p>
        ) : null}
      </div>
      <ComposerCounterFooter bodyLength={bodyLength} isPending={isPending} />
    </form>
  );
}
