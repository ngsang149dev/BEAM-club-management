import type { NextResponse } from 'next/server';
import { badRequest } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import { createTaskDeliverableRequestSchema } from '@/lib/tasks';
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

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const taskId = uuidSchema.parse(id);
    const data = await container.tasksService.listDeliverables(auth.actor, taskId);
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

export async function POST(
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
    const parsed = createTaskDeliverableRequestSchema.safeParse(body);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.message === 'errors.invalidDeliverableUrl')) {
        throw badRequest('errors.invalidDeliverableUrl', {}, 'INVALID_DELIVERABLE_URL');
      }
      throw parsed.error;
    }
    const data = await container.tasksService.addDeliverable(
      auth.actor,
      taskId,
      parsed.data,
    );
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
