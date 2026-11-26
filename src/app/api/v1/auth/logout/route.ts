import { NextResponse } from 'next/server';
import {
  clearSessionCookie,
  getRequestId,
  readSessionCookie,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { assertValidCsrfRequest } from '@/server/shared/csrf';
import { toErrorResponse } from '@/server/shared/http';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    assertValidCsrfRequest(request, { appUrl: container.config.appUrl });
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }

  try {
    const result = await container.authService.logout(readSessionCookie(request));
    const response = NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
    clearSessionCookie(response, request, container.config);
    return response;
  } catch (error) {
    const response = toErrorResponse(error, container.logger, requestId);
    clearSessionCookie(response, request, container.config);
    return response;
  }
}
