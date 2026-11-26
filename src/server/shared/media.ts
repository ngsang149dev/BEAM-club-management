import { createHash } from 'node:crypto';
import { badRequest } from '@/lib/errors';
import {
  type AllowedImageMimeType,
  MAX_IMAGE_BYTES,
  isAllowedImageMimeType,
} from '@/lib/media';
import { BINARY_IMAGE_CSP } from '@/lib/security-headers';

export interface ParsedImageAsset {
  readonly mimeType: AllowedImageMimeType;
  readonly buffer: Buffer;
}

const DATA_URL_PATTERN =
  /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i;

function isPng(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  return riff === 'RIFF' && webp === 'WEBP';
}

export function detectImageMimeFromMagicBytes(
  buffer: Buffer,
): AllowedImageMimeType | null {
  if (isPng(buffer)) return 'image/png';
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isWebp(buffer)) return 'image/webp';
  return null;
}

function extractBase64ImageParts(dataUrl: string): {
  readonly claimedMime: AllowedImageMimeType;
  readonly base64Body: string;
} {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) {
    throw badRequest('errors.invalidImageFormat', {}, 'INVALID_IMAGE_FORMAT');
  }
  const claimedMime = (match[1] ?? '').toLowerCase();
  const base64Body = (match[2] ?? '').replace(/\s+/g, '');
  if (!isAllowedImageMimeType(claimedMime) || base64Body.length === 0) {
    throw badRequest('errors.invalidImageFormat', {}, 'INVALID_IMAGE_FORMAT');
  }
  return { claimedMime, base64Body };
}

export function parseAndValidateImageDataUrl(
  dataUrl: string,
  maxBytes: number = MAX_IMAGE_BYTES,
): ParsedImageAsset {
  const { claimedMime, base64Body } = extractBase64ImageParts(dataUrl);
  const buffer = Buffer.from(base64Body, 'base64');
  if (buffer.length === 0) {
    throw badRequest('errors.invalidImageFormat', {}, 'INVALID_IMAGE_FORMAT');
  }
  if (buffer.length > maxBytes) {
    throw badRequest(
      'errors.imageTooLarge',
      { maxBytes },
      'IMAGE_TOO_LARGE',
    );
  }

  const detectedMime = detectImageMimeFromMagicBytes(buffer);
  if (!detectedMime || detectedMime !== claimedMime) {
    throw badRequest('errors.invalidImageFormat', {}, 'INVALID_IMAGE_FORMAT');
  }

  return { mimeType: detectedMime, buffer };
}

export type BinaryImageCacheMode = 'private-no-store' | 'public-cdn';

const IMAGE_SECURITY_CSP = BINARY_IMAGE_CSP;
const PUBLIC_CDN_CACHE_UNVERSIONED =
  'public, max-age=300, s-maxage=300, stale-while-revalidate=3600';
const PUBLIC_CDN_CACHE_VERSIONED =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

function computeImageEtag(data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex');
  return `"${hash}"`;
}

function hasVersionQueryParam(request?: Request): boolean {
  if (!request) {
    return false;
  }
  try {
    const version = new URL(request.url).searchParams.get('v');
    return Boolean(version && version.trim().length > 0);
  } catch {
    return false;
  }
}

function matchesIfNoneMatch(request: Request | undefined, etag: string): boolean {
  const header = request?.headers.get('if-none-match');
  if (!header) {
    return false;
  }
  for (const part of header.split(',')) {
    const candidate = part.trim();
    if (candidate === '*') {
      return true;
    }
    const normalized = candidate.startsWith('W/')
      ? candidate.slice(2).trim()
      : candidate;
    if (normalized === etag) {
      return true;
    }
  }
  return false;
}

function buildPrivateImageResponse(data: Buffer, mimeType: string): Response {
  const bytes = Uint8Array.from(data);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': IMAGE_SECURITY_CSP,
    },
  });
}

export function buildBinaryImageResponse(input: {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly request?: Request;
  readonly cacheMode?: BinaryImageCacheMode;
}): Response {
  const cacheMode = input.cacheMode ?? 'private-no-store';
  if (cacheMode === 'private-no-store') {
    return buildPrivateImageResponse(input.data, input.mimeType);
  }

  const etag = computeImageEtag(input.data);
  const cacheControl = hasVersionQueryParam(input.request)
    ? PUBLIC_CDN_CACHE_VERSIONED
    : PUBLIC_CDN_CACHE_UNVERSIONED;
  const sharedHeaders = {
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': IMAGE_SECURITY_CSP,
  };

  if (matchesIfNoneMatch(input.request, etag)) {
    return new Response(null, { status: 304, headers: sharedHeaders });
  }

  const bytes = Uint8Array.from(input.data);
  return new Response(bytes, {
    status: 200,
    headers: {
      ...sharedHeaders,
      'Content-Type': input.mimeType,
      'Content-Length': String(bytes.byteLength),
    },
  });
}
