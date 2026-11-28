import { NextResponse } from 'next/server';
import { updateMeRequestSchema } from '@/lib/auth';
import {
  attachLocaleCookie,
  getRequestId,
  parseJsonBody,
  readSessionCookie,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { assertValidCsrfRequest } from '@/server/shared/csrf';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();
  const rawToken = readSessionCookie(request);

  try {
    const result = await container.authService.getMe(rawToken);
    return NextResponse.json(result.response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();
  const rawToken = readSessionCookie(request);

  try {
    assertValidCsrfRequest(request, { appUrl: container.config.appUrl });
    const body = await parseJsonBody(request);
    const { locale } = updateMeRequestSchema.parse(body);
    const result = await container.authService.updateMeLocale(rawToken, locale);
    const response = NextResponse.json(result.response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
    attachLocaleCookie(response, {
      locale,
      request,
      config: container.config,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}
