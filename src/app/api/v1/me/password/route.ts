import type { NextResponse } from 'next/server';
import { changeMyPasswordRequestSchema } from '@/server/modules/auth';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  extractClientIp,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const body = await parseJsonBody(request);
    const input = changeMyPasswordRequestSchema.parse(body);
    const data = await container.authService.changeMyPassword({
      actor: auth.actor,
      currentSessionId: auth.session.id,
      input,
      ip: extractClientIp(request),
    });
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
