import type { NextResponse } from 'next/server';
import { imageUploadRequestSchema } from '@/lib/media';
import { uuidSchema } from '@/lib/members';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';
import { buildBinaryImageResponse } from '@/server/shared/media';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container, { touch: false });
    const { id } = await context.params;
    const memberId = uuidSchema.parse(id);
    const asset = await container.membersService.getMemberAvatar(
      auth.actor,
      memberId,
    );
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

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const { id } = await context.params;
    const memberId = uuidSchema.parse(id);
    const body = await parseJsonBody(request);
    const input = imageUploadRequestSchema.parse(body);
    const data = await container.membersService.updateMemberAvatar({
      actor: auth.actor,
      memberId,
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
    const memberId = uuidSchema.parse(id);
    const data = await container.membersService.removeMemberAvatar({
      actor: auth.actor,
      memberId,
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
