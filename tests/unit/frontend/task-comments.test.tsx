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
  useMeQuery: vi.fn(),
}));

vi.mock('@/features/comments/hooks/useComments', async () => {
  const actual = await vi.importActual<typeof import('@/features/comments/hooks/useComments')>(
    '@/features/comments/hooks/useComments'
  );
  return { ...actual, ...commentsHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

import {
  canDeleteComment,
  TaskCommentsSection,
} from '@/features/comments/components/TaskCommentsSection';
import { COMMENTS_QUERY_KEYS } from '@/features/comments/hooks/useComments';

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
    authHooksMock.useMeQuery.mockReturnValue({ data: { profile: { id: 'u-viewer', departments: [] } } });
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
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { permissions: ['member.view'] }
    );
    expect(withoutPermHtml).toContain('Bình luận');
    expect(withoutPermHtml).toContain('2');
    expect(withoutPermHtml).not.toContain('task-comment-composer');
    expect(withoutPermHtml).not.toContain('Viết bình luận...');

    const withPermHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(withPermHtml).toContain('task-comment-composer');
    expect(withPermHtml).toContain('0 / 4000');
    expect(withPermHtml).toContain('Gửi');

    const adminEnHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { isAdmin: true, locale: 'en' }
    );
    expect(adminEnHtml).toContain('Comments');
    expect(adminEnHtml).toContain('task-comment-composer');
    expect(adminEnHtml).toContain('Send');
  });

  it('gates delete action for author, comment.delete_any, and admin while hiding for others', () => {
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-1' })).toBe(true);
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: true, authorId: 'u-1', currentUserId: 'u-2' })).toBe(true);
    expect(canDeleteComment({ isAdmin: true, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-2' })).toBe(true);
    expect(canDeleteComment({ isAdmin: false, canDeleteAny: false, authorId: 'u-1', currentUserId: 'u-2' })).toBe(false);

    const otherViewerHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(otherViewerHtml).not.toContain('>Xóa<');

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-author', departments: [] } } });
    const authorHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { permissions: ['comment.create'] }
    );
    expect(authorHtml.match(/>Xóa</g) ?? []).toHaveLength(1);

    const deleteAnyHtml = renderWithIntl(
      <TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />,
      { permissions: ['comment.delete_any'] }
    );
    expect(deleteAnyHtml.match(/>Xóa</g) ?? []).toHaveLength(2);
  });

  it('shows (đã rời) / (left) for inactive authors, formats Asia/Ho_Chi_Minh time, and exposes zero PII', () => {
    const viHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />);
    expect(viHtml).toContain('Nguyễn Văn A');
    expect(viHtml).toContain('Vũ Quốc F');
    expect(viHtml).toContain('(đã rời)');
    expect(viHtml).toContain('15:02');
    expect(viHtml).toContain('10:12');
    expect(viHtml).toContain('Đã cập nhật slide');
    expect(viHtml).not.toContain('@eiu.edu.vn');
    expect(viHtml).not.toContain('studentId');

    const enHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={2} />, { locale: 'en' });
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
    const emptyHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={0} />);
    expect(emptyHtml).toContain('Chưa có bình luận nào.');

    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [ACTIVE_AUTHOR_COMMENT], meta: { nextCursor: 'cur-2', limit: 20 } }],
        pageParams: [undefined],
      },
    });
    const loadMoreHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={5} />);
    expect(loadMoreHtml).toContain('Tải thêm bình luận');

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
    const errorHtml = renderWithIntl(<TaskCommentsSection taskId="t-1" boardId="b-1" commentCount={0} />);
    expect(errorHtml).toContain('req-cm-403');
    expect(errorHtml).toContain('Thử lại');
  });
});
