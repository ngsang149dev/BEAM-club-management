import type { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/members';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ id: string; deliverableId: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id, deliverableId } = await context.params;
    const taskId = uuidSchema.parse(id);
    const targetDeliverableId = uuidSchema.parse(deliverableId);
    const data = await container.tasksService.removeDeliverable(
      auth.actor,
      taskId,
      targetDeliverableId,
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
