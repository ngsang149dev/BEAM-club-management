import { NextResponse } from 'next/server';
import { getRequestId } from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const authHeader = request.headers.get('authorization');
    const data = await container.archiveService.runAutoPurgeCron(authHeader);
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
