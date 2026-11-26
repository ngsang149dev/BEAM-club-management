import type { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/members';
import { updateTaskAcceptanceRequestSchema } from '@/lib/tasks';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const taskId = uuidSchema.parse(id);
    const body = await parseJsonBody(request);
    const input = updateTaskAcceptanceRequestSchema.parse(body);
    const data = await container.tasksService.setTaskAcceptance(
      auth.actor,
      taskId,
      input,
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
