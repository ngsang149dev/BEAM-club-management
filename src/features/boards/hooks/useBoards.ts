'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';

export type BoardSummaryDto = components['schemas']['BoardSummaryDto'];
export type BoardDetailDto = components['schemas']['BoardDetailDto'];
export type BoardDetailResponse = components['schemas']['BoardDetailResponse'];
export type BoardPageResponse = components['schemas']['BoardPageResponse'];
export type ColumnDto = components['schemas']['ColumnDto'];
export type CreateBoardRequest = components['schemas']['CreateBoardRequest'];
export type UpdateBoardRequest = components['schemas']['UpdateBoardRequest'];
export type CreateColumnRequest = components['schemas']['CreateColumnRequest'];
export type UpdateColumnRequest = components['schemas']['UpdateColumnRequest'];
export type ReorderColumnsRequest = components['schemas']['ReorderColumnsRequest'];

export interface BoardsFilterState {
  readonly q: string;
  readonly departmentId: string;
  readonly includeArchived: boolean;
  readonly limit?: number;
}

export const DEFAULT_BOARDS_FILTERS: BoardsFilterState = {
  q: '',
  departmentId: '',
  includeArchived: false,
  limit: 20,
};

export const BOARDS_QUERY_KEYS = {
  root: ['boards'] as const,
  list: (filters: Pick<BoardsFilterState, 'departmentId' | 'includeArchived' | 'limit'>) =>
    ['boards', 'list', filters] as const,
  detail: (boardId: string) => ['boardDetail', boardId] as const,
};

async function invalidateBoardQueries(queryClient: QueryClient, boardId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: BOARDS_QUERY_KEYS.root }),
    ...(boardId ? [queryClient.invalidateQueries({ queryKey: BOARDS_QUERY_KEYS.detail(boardId) })] : []),
    queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
  ]);
}

function shouldRetryBoardDetail(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && (error.status === 404 || error.status === 403 || error.status === 401)) {
    return false;
  }
  return failureCount < 1;
}

export function useBoardsInfiniteQuery(
  filters: Pick<BoardsFilterState, 'departmentId' | 'includeArchived' | 'limit'>,
  enabled = true
) {
  return useInfiniteQuery({
    queryKey: BOARDS_QUERY_KEYS.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/boards', {
        query: {
          ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
          includeArchived: filters.includeArchived,
          ...(pageParam ? { cursor: pageParam } : {}),
          limit: filters.limit ?? 20,
        },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useBoardDetailQuery(boardId: string, enabled = true) {
  return useQuery({
    queryKey: BOARDS_QUERY_KEYS.detail(boardId),
    queryFn: ({ signal }) => apiFetch('/boards/{id}', { params: { id: boardId }, signal }),
    enabled: enabled && Boolean(boardId),
    retry: shouldRetryBoardDetail,
  });
}

export function useCreateBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBoardRequest) => apiFetch('/boards', { method: 'post', body: payload }),
    onSuccess: async (data) => invalidateBoardQueries(queryClient, data.board.id),
  });
}

export function useUpdateBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBoardRequest }) =>
      apiFetch('/boards/{id}', { method: 'patch', params: { id }, body: payload }),
    onSuccess: async (data) => invalidateBoardQueries(queryClient, data.board.id),
  });
}

export function useArchiveBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch('/boards/{id}', { method: 'delete', params: { id } }),
    onSuccess: async (data) => invalidateBoardQueries(queryClient, data.board.id),
  });
}

export function useCreateColumnMutation(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateColumnRequest) =>
      apiFetch('/boards/{id}/columns', { method: 'post', params: { id: boardId }, body: payload }),
    onSuccess: async () => invalidateBoardQueries(queryClient, boardId),
  });
}

export function useRenameColumnMutation(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ columnId, payload }: { columnId: string; payload: UpdateColumnRequest }) =>
      apiFetch('/columns/{id}', { method: 'patch', params: { id: columnId }, body: payload }),
    onSuccess: async () => invalidateBoardQueries(queryClient, boardId),
  });
}

export function useDeleteColumnMutation(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (columnId: string) =>
      apiFetch('/columns/{id}', { method: 'delete', params: { id: columnId } }),
    onSuccess: async () => invalidateBoardQueries(queryClient, boardId),
  });
}

export function applyOptimisticColumnReorder(
  board: BoardDetailDto,
  columnIds: readonly string[]
): BoardDetailDto {
  const orderMap = new Map(columnIds.map((id, idx) => [id, idx]));
  const nextColumns = [...board.columns]
    .sort((a, b) => (orderMap.get(a.id) ?? a.orderIndex) - (orderMap.get(b.id) ?? b.orderIndex))
    .map((column, idx) => ({ ...column, orderIndex: idx }));
  return { ...board, columns: nextColumns };
}

export function useReorderColumnsMutation(boardId: string) {
  const queryClient = useQueryClient();
  const detailKey = BOARDS_QUERY_KEYS.detail(boardId);

  return useMutation({
    mutationFn: (payload: ReorderColumnsRequest) =>
      apiFetch('/boards/{id}/columns/order', { method: 'put', params: { id: boardId }, body: payload }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<BoardDetailResponse>(detailKey);
      queryClient.setQueryData<BoardDetailResponse>(detailKey, (old) =>
        old ? { board: applyOptimisticColumnReorder(old.board, payload.columnIds) } : old
      );
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(detailKey, context.previous);
      }
    },
    onSettled: async () => invalidateBoardQueries(queryClient, boardId),
  });
}
