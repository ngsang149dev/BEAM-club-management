import type { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/members';
import { listBoardTrashQuerySchema } from '@/lib/task-events';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const boardId = uuidSchema.parse(id);
    const searchParams = new URL(request.url).searchParams;
    const query = listBoardTrashQuerySchema.parse({
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    const data = await container.taskEventsService.listBoardTrash(
      auth.actor,
      boardId,
      query,
    );
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
