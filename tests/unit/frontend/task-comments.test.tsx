import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const commentsHooksMock = vi.hoisted(() => ({
  useTaskCommentsInfiniteQuery: vi.fn(),
  useCreateCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const authHooksMock = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('@/features/comments/hooks/useComments', async () => {
  const actual = await vi.importActual<typeof import('@/features/comments/hooks/useComments')>(
    '@/features/comments/hooks/useComments'
  );
  return { ...actual, ...commentsHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

import {
  COMMENT_COLLAPSE_CHAR_THRESHOLD,
  COMMENT_COLLAPSE_LINE_THRESHOLD,
  isLongCommentBody,
} from '@/features/comments/components/CommentItemRow';
import {
  canDeleteComment,
  TaskCommentsSection,
} from '@/features/comments/components/TaskCommentsSection';
import { COMMENTS_PAGE_SIZE, COMMENTS_QUERY_KEYS } from '@/features/comments/hooks/useComments';

type CommentDto = components['schemas']['CommentDto'];

const ACTIVE_AUTHOR_COMMENT: CommentDto = {
  id: 'cm-1',
  taskId: 't-1',
  author: {
    id: 'u-author',
    fullName: 'Nguyễn Văn A',
    isActive: true,
    leftAt: null,
    avatarUrl: null,
    departments: [],
  },
  body: 'Đã cập nhật slide\nNhờ xem giúp phần 2.',
  createdAt: '2026-11-23T08:02:00Z',
};

const INACTIVE_AUTHOR_COMMENT: CommentDto = {
  id: 'cm-2',
  taskId: 't-1',
  author: {
    id: 'u-former',
    fullName: 'Vũ Quốc F',
    isActive: false,
    leftAt: '2026-11-10T00:00:00Z',
    avatarUrl: null,
    departments: [],
  },
  body: 'Bản nháp ở thư mục chung.',
  createdAt: '2026-11-20T03:12:00Z',
};

function renderWithIntl(
  node: ReactNode,
  options: { permissions?: PermissionCode[]; isAdmin?: boolean; locale?: 'vi' | 'en' } = {}
) {
  const locale = options.locale ?? 'vi';
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'vi' ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
        {node}
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('TaskCommentsSection (E7-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHooksMock.useSessionQuery.mockReturnValue({ data: { userId: 'u-viewer' } });
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [ACTIVE_AUTHOR_COMMENT, INACTIVE_AUTHOR_COMMENT], meta: { nextCursor: null, limit: 20 } }],
        pageParams: [undefined],
      },
    });
  });

  it('gates composer by comment.create or admin and renders comment counter', () => {
    const withoutPermHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { permissions: ['member.view'] }
    );
    expect(withoutPermHtml).toContain('Mới nhất trước');
    expect(withoutPermHtml).toContain('2');
    expect(withoutPermHtml).not.toContain('task-comment-composer');
    expect(withoutPermHtml).not.toContain('Viết bình luận...');

    const withPermHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(withPermHtml).toContain('task-comment-composer');
    expect(withPermHtml).toContain('task-comments-composer-pin');
    expect(withPermHtml).toContain('task-comments-scroll');
    expect(withPermHtml.indexOf('task-comment-composer')).toBeLessThan(
      withPermHtml.indexOf('task-comments-scroll')
    );
    expect(withPermHtml).toContain('Mới nhất trước');
    expect(withPermHtml).toContain('0 / 4000');
    expect(withPermHtml).toContain('Gửi');

    const adminEnHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { isAdmin: true, locale: 'en' }
    );
    expect(adminEnHtml).toContain('Newest first');
    expect(adminEnHtml).toContain('Write a comment...');
    expect(adminEnHtml).toContain('task-comment-composer');
    expect(adminEnHtml).toContain('Send');
    expect(COMMENTS_PAGE_SIZE).toBe(10);
  });

  it('gates delete action for author, comment.delete_any, and admin while hiding for others', () => {
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-1' })).toBe(true);
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: true, authorId: 'u-1', currentUserId: 'u-2' })).toBe(true);
    expect(canDeleteComment({ isAdmin: true, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-2' })).toBe(true);
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-2' })).toBe(false);

    const otherViewerHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(otherViewerHtml).not.toContain('>Xóa<');

    authHooksMock.useSessionQuery.mockReturnValueOnce({ data: { userId: 'u-author' } });
    const authorHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(authorHtml.match(/>Xóa</g) ?? []).toHaveLength(1);

    const deleteAnyHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={2} />,
      { permissions: ['comment.delete_any'] }
    );
    expect(deleteAnyHtml.match(/>Xóa</g) ?? []).toHaveLength(2);
  });

  it('shows (đã rời) / (left) for inactive authors, formats Asia/Ho_Chi_Minh time, and exposes zero PII', () => {
    const viHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={2} />);
    expect(viHtml).toContain('Nguyễn Văn A');
    expect(viHtml).toContain('Vũ Quốc F');
    expect(viHtml).toContain('(đã rời)');
    expect(viHtml).toContain('15:02');
    expect(viHtml).toContain('10:12');
    expect(viHtml).toContain('Đã cập nhật slide');
    expect(viHtml).not.toContain('@eiu.edu.vn');
    expect(viHtml).not.toContain('studentId');

    const enHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={2} />, { locale: 'en' });
    expect(enHtml).toContain('(left)');
    expect(COMMENTS_QUERY_KEYS.byTask('t-1')).toEqual(['comments', 'task', 't-1']);
  });

  it('renders empty state, load-more button, and API error state cleanly', () => {
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }], pageParams: [undefined] },
    });
    const emptyHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={0} />);
    expect(emptyHtml).toContain('Chưa có bình luận nào.');

    const loadMorePage = {
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [ACTIVE_AUTHOR_COMMENT], meta: { nextCursor: 'cur-2', limit: 10 } }],
        pageParams: [undefined],
      },
    };
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce(loadMorePage);
    const loadMoreHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={5} />);
    expect(loadMoreHtml).toContain('Xem thêm bình luận cũ hơn');
    expect(loadMoreHtml).toContain('Đang hiện 1 / 5');

    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce(loadMorePage);
    const loadMoreEnHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" commentCount={5} />,
      { locale: 'en' }
    );
    expect(loadMoreEnHtml).toContain('Load older comments');
    expect(loadMoreEnHtml).toContain('Showing 1 of 5');

    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {}, requestId: 'req-cm-403' }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const errorHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={0} />);
    expect(errorHtml).toContain('req-cm-403');
    expect(errorHtml).toContain('Thử lại');
  });

  it('collapses long comments by char or line threshold and omits expand toggle for short comments', () => {
    expect(COMMENT_COLLAPSE_CHAR_THRESHOLD).toBe(320);
    expect(COMMENT_COLLAPSE_LINE_THRESHOLD).toBe(5);
    expect(isLongCommentBody('Short text')).toBe(false);
    expect(isLongCommentBody('a'.repeat(321))).toBe(true);
    expect(isLongCommentBody('1\n2\n3\n4\n5\n6')).toBe(true);

    const longComment: CommentDto = {
      ...ACTIVE_AUTHOR_COMMENT,
      id: 'cm-long',
      body: 'Dòng 1\nDòng 2\nDòng 3\nDòng 4\nDòng 5\nDòng 6 chi tiết dài',
    };
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [longComment], meta: { nextCursor: null, limit: 10 } }],
        pageParams: [undefined],
      },
    });
    const longHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={1} />);
    expect(longHtml).toContain('task-comment-body is-clamped');
    expect(longHtml).toContain('task-comment-expand-btn');
    expect(longHtml).toContain('Xem thêm');

    const shortHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" commentCount={2} />);
    expect(shortHtml).not.toContain('task-comment-body is-clamped');
    expect(shortHtml).not.toContain('task-comment-expand-btn');
  });
});
