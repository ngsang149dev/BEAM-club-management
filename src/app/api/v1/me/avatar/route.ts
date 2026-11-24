import type { NextResponse } from 'next/server';
import { imageUploadRequestSchema } from '@/lib/media';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function PUT(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const body = await parseJsonBody(request);
    const input = imageUploadRequestSchema.parse(body);
    const data = await container.authService.updateMyAvatar({
      actor: auth.actor,
      dataUrl: input.dataUrl,
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

export async function DELETE(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const data = await container.authService.removeMyAvatar({
      actor: auth.actor,
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
