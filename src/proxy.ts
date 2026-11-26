import { type NextRequest, NextResponse } from 'next/server';
import { validateCsrfRequest } from '@/server/shared/csrf';

function resolveRequestId(request: NextRequest): string {
  const incoming = request.headers.get('x-request-id')?.trim();
  if (incoming && incoming.length <= 128 && !/[\r\n]/.test(incoming)) {
    return incoming;
  }
  return globalThis.crypto.randomUUID();
}

export function proxy(request: NextRequest): NextResponse {
  const result = validateCsrfRequest(request, {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!result.ok) {
    const requestId = resolveRequestId(request);
    return NextResponse.json(
      {
        error: {
          code: 'CSRF_ORIGIN_MISMATCH',
          messageKey: 'errors.forbidden',
          details: {
            reason: result.reason,
            requestId,
          },
        },
      },
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/v1/:path*'],
};
