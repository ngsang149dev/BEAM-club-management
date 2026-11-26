import type { NextResponse } from 'next/server';
import { listNotificationsQuerySchema } from '@/lib/notifications';
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
    const isBackgroundPoll = request.headers.get('x-beam-background') === '1';
    const auth = await authenticateApiRequest(request, container, {
      touch: !isBackgroundPoll,
    });
    const searchParams = new URL(request.url).searchParams;
    const query = listNotificationsQuerySchema.parse({
      unreadOnly: searchParams.get('unreadOnly'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    const data = await container.notificationsService.listForUser(
      auth.actor,
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
