import type { NextResponse } from 'next/server';
import { listMyTasksQuerySchema } from '@/lib/tasks';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const searchParams = new URL(request.url).searchParams;
    const query = listMyTasksQuerySchema.parse({
      boardId: searchParams.get('boardId'),
      departmentId: searchParams.get('departmentId'),
      q: searchParams.get('q'),
      includeDone: searchParams.get('includeDone'),
      priority: searchParams.get('priority'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    const data = await container.tasksService.listMyTasks(auth.actor, query);
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
