import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateLoginGalleryItemRequestSchema } from '@/lib/media';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

const uuidSchema = z.uuid();

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const itemId = uuidSchema.parse(id);
    const body = await parseJsonBody(request);
    const input = updateLoginGalleryItemRequestSchema.parse(body);
    const data = await container.brandingService.updateGalleryItem({
      actor: auth.actor,
      itemId,
      title: input.title,
      caption: input.caption,
      dataUrl: input.dataUrl,
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

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const itemId = uuidSchema.parse(id);
    const data = await container.brandingService.deleteGalleryItem({
      actor: auth.actor,
      itemId,
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
