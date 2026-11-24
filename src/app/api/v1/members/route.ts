import type { NextResponse } from 'next/server';
import { createMemberRequestSchema, listMembersQuerySchema } from '@/lib/members';
import {
  authenticateApiRequest,
  createAuthenticatedJsonResponse,
  getRequestId,
  parseJsonBody,
} from '@/server/shared/auth-http';
import { getContainer } from '@/server/shared/composition';
import { toErrorResponse } from '@/server/shared/http';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const searchParams = new URL(request.url).searchParams;
    const query = listMembersQuerySchema.parse({
      q: searchParams.get('q'),
      departmentId: searchParams.get('departmentId'),
      isActive: searchParams.get('isActive'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    const data = await container.membersService.listMembers(auth.actor, query);
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

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const container = getContainer();

  try {
    const auth = await authenticateApiRequest(request, container);
    const body = await parseJsonBody(request);
    const input = createMemberRequestSchema.parse(body);
    const data = await container.membersService.createMember(auth.actor, input);
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
