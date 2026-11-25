import type { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/members';
import { revertTaskEventRequestSchema } from '@/lib/task-events';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseOptionalJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ id: string; eventId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id, eventId } = await context.params;
    const taskId = uuidSchema.parse(id);
    const targetEventId = uuidSchema.parse(eventId);
    const body = await parseOptionalJsonBody(request);
    const input = revertTaskEventRequestSchema.parse(body);
    const data = await container.taskEventsService.revertTaskEvent(
      auth.actor,
      taskId,
      targetEventId,
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
