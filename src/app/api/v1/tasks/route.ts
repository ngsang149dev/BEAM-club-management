import type { NextResponse } from 'next/server';
import { badRequest } from '@/lib/errors';
import { createTaskRequestSchema, listTasksQuerySchema } from '@/lib/tasks';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

function extractTasksSearchInput(searchParams: URLSearchParams) {
  return {
    boardId: searchParams.get('boardId'),
    columnId: searchParams.get('columnId'),
    assigneeId: searchParams.get('assigneeId'),
    departmentId: searchParams.get('departmentId'),
    priority: searchParams.get('priority'),
    dueStatus: searchParams.get('dueStatus'),
    deadlineStatus: searchParams.get('deadlineStatus'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    q: searchParams.get('q'),
    sortBy: searchParams.get('sortBy'),
    sortOrder: searchParams.get('sortOrder'),
    cursor: searchParams.get('cursor'),
    limit: searchParams.get('limit'),
  };
}

function unwrapDateRangeOrThrow<T>(
  parsed: ReturnType<typeof listTasksQuerySchema.safeParse> | ReturnType<typeof createTaskRequestSchema.safeParse>,
): T {
  if (parsed.success) return parsed.data as T;
  if (parsed.error.issues.some((issue) => issue.message === 'errors.invalidDateRange')) {
    throw badRequest('errors.invalidDateRange', {}, 'INVALID_DATE_RANGE');
  }
  throw parsed.error;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const parsed = listTasksQuerySchema.safeParse(
      extractTasksSearchInput(new URL(request.url).searchParams),
    );
    const query = unwrapDateRangeOrThrow<ReturnType<typeof listTasksQuerySchema.parse>>(parsed);
    const data = await container.tasksService.listTasks(auth.actor, query);
    return createAuthenticatedJsonResponse(data, {
      requestId,
      rawToken: auth.rawToken,
      rememberMe: auth.session.rememberMe,
      request,
      config: container.config,
    });
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const body = await parseJsonBody(request);
    const parsed = createTaskRequestSchema.safeParse(body);
    const input = unwrapDateRangeOrThrow<ReturnType<typeof createTaskRequestSchema.parse>>(parsed);
    const data = await container.tasksService.createTask(auth.actor, input);
    return createAuthenticatedJsonResponse(data, {
      status: 201,
      requestId,
      rawToken: auth.rawToken,
      rememberMe: auth.session.rememberMe,
      request,
      config: container.config,
    });
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}
