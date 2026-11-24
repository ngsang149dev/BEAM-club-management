import { NextResponse } from 'next/server';
import { getRequestId } from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const data = await container.brandingService.getBranding();
    return NextResponse.json(data, {
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
