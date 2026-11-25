import { z } from 'zod';
import { getRequestId } from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';
import { buildBinaryImageResponse } from '@/server/shared/media';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

const uuidSchema = z.uuid();

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const { id } = await context.params;
    const itemId = uuidSchema.parse(id);
    const asset = await container.brandingService.getGalleryImage(itemId);
    const response = buildBinaryImageResponse({
      data: asset.data,
      mimeType: asset.mimeType,
    });
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    return toErrorResponse(error, container.logger, requestId);
  }
}
