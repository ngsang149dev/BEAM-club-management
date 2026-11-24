import type { NextResponse } from 'next/server';
import { archiveEntityTypeSchema } from '@/lib/archive';
import { uuidSchema } from '@/lib/members';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ entityType: string; id: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const params = await context.params;
    const entityType = archiveEntityTypeSchema.parse(params.entityType);
    const entityId = uuidSchema.parse(params.id);
    const data = await container.archiveService.purgeEntity(
      auth.actor,
      entityType,
      entityId,
    );
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
