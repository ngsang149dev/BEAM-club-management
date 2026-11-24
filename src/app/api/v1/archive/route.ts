import type { NextResponse } from 'next/server';
import { listArchiveQuerySchema } from '@/lib/archive';
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
    const auth = await authenticateApiRequest(request, container);
    const searchParams = new URL(request.url).searchParams;
    const query = listArchiveQuerySchema.parse({
      tab: searchParams.get('tab'),
      q: searchParams.get('q'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    const data = await container.archiveService.listArchive(auth.actor, query);
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
