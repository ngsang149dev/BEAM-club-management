import { NextResponse } from 'next/server';
import {
  getRequestId,
  readSessionCookie,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();
  const rawToken = readSessionCookie(request);

  try {
    const result = await container.authService.getSessionInfo(rawToken);
    return NextResponse.json(result, {
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
