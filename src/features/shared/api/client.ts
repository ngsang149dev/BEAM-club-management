import type { components, paths } from './schema';

export type { components, paths } from './schema';

export const API_BASE_PATH = '/api/v1';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
type SuccessStatus = 200 | 201 | 204;

type AvailableMethod<P extends keyof paths> = {
  [M in HttpMethod]: paths[P][M] extends never | undefined ? never : M;
}[HttpMethod];

type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P][M] extends never | undefined ? never : P;
}[keyof paths];

type OperationOf<P extends keyof paths, M extends HttpMethod> = Exclude<paths[P][M], never | undefined>;

type PathParamsOf<Op> = Op extends { parameters: { path: infer P } }
  ? P extends Record<string, string | number>
    ? P
    : never
  : never;

type QueryParamsOf<Op> = Op extends { parameters: { query?: infer Q } } ? Exclude<Q, undefined> : never;

type RequestBodyOf<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : Op extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B
    : never;

type JsonContent<R> = R extends { content: { 'application/json': infer T } } ? T : void;

export type ApiResponse<P extends keyof paths, M extends AvailableMethod<P>> =
  OperationOf<P, M> extends { responses: infer R }
    ? { [K in Extract<keyof R, SuccessStatus>]: JsonContent<R[K]> }[Extract<keyof R, SuccessStatus>]
    : never;

type PathOption<Op> = [PathParamsOf<Op>] extends [never] ? { params?: never } : { params: PathParamsOf<Op> };
type QueryOption<Op> = [QueryParamsOf<Op>] extends [never] ? { query?: never } : { query?: QueryParamsOf<Op> };
type BodyOption<Op> = [RequestBodyOf<Op>] extends [never]
  ? { body?: never }
  : Op extends { requestBody: unknown }
    ? { body: RequestBodyOf<Op> }
    : { body?: RequestBodyOf<Op> };

interface BaseFetchConfig {
  signal?: AbortSignal;
  headers?: HeadersInit;
  cache?: RequestCache;
  credentials?: RequestCredentials;
}

export type ApiRequestOptions<P extends keyof paths, M extends AvailableMethod<P>> = BaseFetchConfig &
  PathOption<OperationOf<P, M>> &
  QueryOption<OperationOf<P, M>> &
  BodyOption<OperationOf<P, M>> & { method: M };

export type GetRequestOptions<P extends PathsWithMethod<'get'>> = BaseFetchConfig &
  PathOption<OperationOf<P, 'get'>> &
  QueryOption<OperationOf<P, 'get'>> & { method?: 'get' };

type GetPathsWithoutParams = {
  [P in PathsWithMethod<'get'>]: [PathParamsOf<OperationOf<P, 'get'>>] extends [never] ? P : never;
}[PathsWithMethod<'get'>];

export type ApiErrorEnvelope = components['schemas']['ErrorResponse']['error'];

export interface ApiClientErrorInit {
  status: number;
  code: string;
  messageKey: string;
  details: Record<string, unknown>;
  requestId?: string;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageKey: string;
  readonly details: Record<string, unknown>;
  readonly requestId?: string;

  constructor(init: ApiClientErrorInit) {
    super(init.messageKey, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ApiClientError';
    this.status = init.status;
    this.code = init.code;
    this.messageKey = init.messageKey;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

interface RawRequestOptions extends BaseFetchConfig {
  method?: HttpMethod;
  params?: object;
  query?: object;
  body?: unknown;
}

const STATUS_FALLBACKS: Record<number, { code: string; messageKey: string }> = {
  400: { code: 'BAD_REQUEST', messageKey: 'errors.badRequest' },
  401: { code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' },
  403: { code: 'FORBIDDEN', messageKey: 'errors.forbidden' },
  404: { code: 'NOT_FOUND', messageKey: 'errors.notFound' },
  409: { code: 'CONFLICT', messageKey: 'errors.conflict' },
  429: { code: 'TOO_MANY_REQUESTS', messageKey: 'errors.tooManyRequests' },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveStatusFallback(status: number): { code: string; messageKey: string } {
  const exact = STATUS_FALLBACKS[status];
  if (exact) {
    return exact;
  }
  return status >= 500
    ? { code: 'INTERNAL_ERROR', messageKey: 'errors.internal' }
    : { code: 'HTTP_ERROR', messageKey: 'errors.unknown' };
}

function interpolatePath(pathTemplate: string, params?: object): string {
  const paramMap = isPlainRecord(params) ? params : undefined;
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = paramMap?.[key];
    if (value === undefined || value === null) {
      throw new ApiClientError({ status: 400, code: 'INVALID_PATH_PARAM', messageKey: 'errors.badRequest', details: { param: key } });
    }
    return encodeURIComponent(String(value));
  });
}

function buildUrl(pathTemplate: string, params?: object, query?: object): string {
  const resolvedPath = interpolatePath(pathTemplate, params);
  const searchParams = new URLSearchParams();
  if (isPlainRecord(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
  }
  const qs = searchParams.toString();
  return `${API_BASE_PATH}${resolvedPath}${qs ? `?${qs}` : ''}`;
}

function buildRequestInit(options: RawRequestOptions): RequestInit {
  const headers = new Headers(options.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    body = JSON.stringify(options.body);
  }
  return {
    method: (options.method ?? 'get').toUpperCase(),
    headers,
    body,
    signal: options.signal,
    cache: options.cache,
    credentials: options.credentials ?? 'same-origin',
  };
}

function extractEnvelope(parsed: unknown): ApiErrorEnvelope | null {
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.error)) {
    return null;
  }
  const { code, messageKey, details } = parsed.error;
  if (typeof code !== 'string' || typeof messageKey !== 'string') {
    return null;
  }
  return { code, messageKey, details: isPlainRecord(details) ? details : {} };
}

async function readResponseJson(response: Response): Promise<{ ok: true; data: unknown } | { ok: false }> {
  if (response.status === 204) {
    return { ok: true, data: undefined };
  }
  try {
    const rawText = await response.text();
    return { ok: true, data: rawText ? (JSON.parse(rawText) as unknown) : undefined };
  } catch {
    return { ok: false };
  }
}

function toHttpApiError(
  status: number,
  requestId: string | undefined,
  parsed: { ok: true; data: unknown } | { ok: false }
): ApiClientError {
  if (parsed.ok) {
    const envelope = extractEnvelope(parsed.data);
    if (envelope) {
      const resolvedRequestId =
        requestId ?? (typeof envelope.details.requestId === 'string' ? envelope.details.requestId : undefined);
      return new ApiClientError({
        status,
        code: envelope.code,
        messageKey: envelope.messageKey,
        details: envelope.details,
        requestId: resolvedRequestId,
      });
    }
  }
  const fallback = resolveStatusFallback(status);
  return new ApiClientError({ status, code: fallback.code, messageKey: fallback.messageKey, details: {}, requestId });
}

async function executeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiClientError({ status: 0, code: 'NETWORK_ERROR', messageKey: 'errors.network', details: {}, cause: error });
  }
}

function readRawOptions(options: unknown): RawRequestOptions {
  if (!isPlainRecord(options)) {
    return {};
  }
  return {
    method: typeof options.method === 'string' ? (options.method as HttpMethod) : undefined,
    params: isPlainRecord(options.params) ? options.params : undefined,
    query: isPlainRecord(options.query) ? options.query : undefined,
    body: options.body,
    signal: options.signal instanceof AbortSignal ? options.signal : undefined,
    headers: options.headers as HeadersInit | undefined,
    cache: typeof options.cache === 'string' ? (options.cache as RequestCache) : undefined,
    credentials: typeof options.credentials === 'string' ? (options.credentials as RequestCredentials) : undefined,
  };
}

async function executeApiFetch(path: string, rawOptions?: object): Promise<unknown> {
  const options = readRawOptions(rawOptions);
  const url = buildUrl(path, options.params, options.query);
  const response = await executeFetch(url, buildRequestInit(options));
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const parsed = await readResponseJson(response);
  if (!response.ok) {
    throw toHttpApiError(response.status, requestId, parsed);
  }
  if (!parsed.ok) {
    throw new ApiClientError({ status: response.status, code: 'INVALID_RESPONSE', messageKey: 'errors.invalidResponse', details: {}, requestId });
  }
  return parsed.data;
}

export function apiFetch<P extends GetPathsWithoutParams>(
  path: P,
  options?: GetRequestOptions<P>
): Promise<ApiResponse<P, Extract<AvailableMethod<P>, 'get'>>>;
export function apiFetch<P extends PathsWithMethod<'get'>>(
  path: P,
  options: GetRequestOptions<P>
): Promise<ApiResponse<P, Extract<AvailableMethod<P>, 'get'>>>;
export function apiFetch<P extends keyof paths, M extends AvailableMethod<P>>(
  path: P,
  options: ApiRequestOptions<P, M>
): Promise<ApiResponse<P, M>>;
export function apiFetch(path: string, options?: object): Promise<never> {
  return executeApiFetch(path, options) as Promise<never>;
}
