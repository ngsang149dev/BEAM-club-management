import type { NextResponse } from 'next/server';
import { createTaskRequestSchema, listTasksQuerySchema } from '@/lib/tasks';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const searchParams = new URL(request.url).searchParams;
    const query = listTasksQuerySchema.parse({
      boardId: searchParams.get('boardId'),
      columnId: searchParams.get('columnId'),
      assigneeId: searchParams.get('assigneeId'),
      priority: searchParams.get('priority'),
      dueStatus: searchParams.get('dueStatus'),
      q: searchParams.get('q'),
      sortBy: searchParams.get('sortBy'),
      sortOrder: searchParams.get('sortOrder'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
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
    const input = createTaskRequestSchema.parse(body);
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
