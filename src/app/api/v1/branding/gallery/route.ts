import type { NextResponse } from 'next/server';
import { createLoginGalleryItemRequestSchema } from '@/lib/media';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const body = await parseJsonBody(request);
    const input = createLoginGalleryItemRequestSchema.parse(body);
    const data = await container.brandingService.createGalleryItem({
      actor: auth.actor,
      title: input.title,
      caption: input.caption,
      dataUrl: input.dataUrl,
    });
    return createAuthenticatedJsonResponse(data, {
      status: 201,
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
