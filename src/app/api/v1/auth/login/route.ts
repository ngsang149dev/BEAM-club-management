import { NextResponse } from 'next/server';
import { loginRequestSchema } from '@/server/modules/auth';
import {
  attachLocaleCookie,
  attachSessionCookie,
  extractClientIp,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { assertValidCsrfRequest } from '@/server/shared/csrf';
import { toErrorResponse } from '@/server/shared/http';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    assertValidCsrfRequest(request, { appUrl: container.config.appUrl });
    const body = await parseJsonBody(request);
    const input = loginRequestSchema.parse(body);
    const result = await container.authService.login({
      studentId: input.studentId,
      password: input.password,
      remember: input.remember,
      returnTo: input.returnTo,
      ip: extractClientIp(request),
    });

    const response = NextResponse.json(result.response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
    attachSessionCookie(response, {
      rawToken: result.rawToken,
      rememberMe: result.rememberMe,
      request,
      config: container.config,
    });
    attachLocaleCookie(response, {
      locale: result.locale,
      request,
      config: container.config,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}
