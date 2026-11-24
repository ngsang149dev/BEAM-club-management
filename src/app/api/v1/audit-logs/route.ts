import type { NextResponse } from 'next/server';
import { badRequest } from '@/lib/errors';
import { listAuditLogsQuerySchema } from '@/lib/permissions';
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
    const parsed = listAuditLogsQuerySchema.safeParse({
      actorId: searchParams.get('actorId'),
      targetUserId: searchParams.get('targetUserId'),
      action: searchParams.get('action'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.message === 'errors.invalidDateRange')) {
        throw badRequest('errors.invalidDateRange', {}, 'INVALID_DATE_RANGE');
      }
      throw parsed.error;
    }

    const data = await container.auditService.listAuditLogs(auth.actor, parsed.data);
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
