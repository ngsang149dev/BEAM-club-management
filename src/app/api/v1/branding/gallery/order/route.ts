import type { NextResponse } from 'next/server';
import { reorderLoginGalleryRequestSchema } from '@/lib/media';
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
    const input = reorderLoginGalleryRequestSchema.parse(body);
    const data = await container.brandingService.reorderGalleryItems({
      actor: auth.actor,
      itemIds: input.itemIds,
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
