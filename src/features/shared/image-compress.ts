import { isApiClientError } from '@/features/shared/api/client';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_FILE_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_LENGTH,
  isAllowedImageMimeType,
} from '@/lib/media';

export {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_FILE_ACCEPT,
  MAX_IMAGE_BYTES,
  isAllowedImageMimeType,
};

export type ImageCompressErrorCode = 'INVALID_IMAGE_FORMAT' | 'IMAGE_TOO_LARGE';

export class ImageCompressError extends Error {
  readonly code: ImageCompressErrorCode;

  constructor(code: ImageCompressErrorCode) {
    super(code);
    this.name = 'ImageCompressError';
    this.code = code;
  }
}

export function isImageCompressError(error: unknown): error is ImageCompressError {
  return error instanceof ImageCompressError;
}

export type ImageUploadErrorKey =
  | 'invalidImageFormat'
  | 'imageTooLarge'
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'network'
  | 'unknown';

const UPLOAD_ERROR_CODE_MAP: Record<string, ImageUploadErrorKey> = {
  INVALID_IMAGE_FORMAT: 'invalidImageFormat',
  IMAGE_TOO_LARGE: 'imageTooLarge',
  VALIDATION_ERROR: 'validation',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  NETWORK_ERROR: 'network',
};

const UPLOAD_ERROR_STATUS_MAP: Record<number, ImageUploadErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
};

export function resolveImageUploadErrorKey(error: unknown): ImageUploadErrorKey | null {
  if (!error) {
    return null;
  }
  if (isImageCompressError(error)) {
    return error.code === 'INVALID_IMAGE_FORMAT' ? 'invalidImageFormat' : 'imageTooLarge';
  }
  if (!isApiClientError(error)) {
    return 'unknown';
  }
  return UPLOAD_ERROR_CODE_MAP[error.code] ?? UPLOAD_ERROR_STATUS_MAP[error.status] ?? 'unknown';
}

const DEFAULT_MAX_DIMENSION = 512;
const RESIZE_DIMENSIONS = [512, 384, 256] as const;
const ENCODING_ATTEMPTS: readonly { mime: 'image/webp' | 'image/jpeg'; quality: number }[] = [
  { mime: 'image/webp', quality: 0.86 },
  { mime: 'image/webp', quality: 0.72 },
  { mime: 'image/webp', quality: 0.58 },
  { mime: 'image/jpeg', quality: 0.86 },
  { mime: 'image/jpeg', quality: 0.72 },
  { mime: 'image/jpeg', quality: 0.58 },
];

const DATA_URL_PREFIX_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/;

export function estimateDataUrlDecodedBytes(dataUrl: string): number {
  const match = DATA_URL_PREFIX_RE.exec(dataUrl.trim());
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }
  const mime = match[1] ?? '';
  if (!isAllowedImageMimeType(mime)) {
    return Number.POSITIVE_INFINITY;
  }
  const base64 = (match[2] ?? '').replace(/\s+/g, '');
  if (base64.length === 0 || base64.length % 4 !== 0) {
    return Number.POSITIVE_INFINITY;
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function isDataUrlWithinBudget(dataUrl: string): boolean {
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return false;
  }
  const decodedBytes = estimateDataUrlDecodedBytes(dataUrl);
  return Number.isFinite(decodedBytes) && decodedBytes > 0 && decodedBytes <= MAX_IMAGE_BYTES;
}

export function computeScaledDimensions(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxDim, height: maxDim };
  }
  if (width <= maxDim && height <= maxDim) {
    return { width, height };
  }
  if (width >= height) {
    return { width: maxDim, height: Math.max(1, Math.round((height * maxDim) / width)) };
  }
  return { width: Math.max(1, Math.round((width * maxDim) / height)), height: maxDim };
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new ImageCompressError('INVALID_IMAGE_FORMAT'));
      };
      reader.onerror = () => reject(new ImageCompressError('INVALID_IMAGE_FORMAT'));
      reader.readAsDataURL(file);
    });
  }
  const buffer = await file.arrayBuffer();
  const mime = file.type.toLowerCase();
  return `data:${mime};base64,${encodeBytesToBase64(new Uint8Array(buffer))}`;
}

export function isCanvasSupported(): boolean {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return false;
  }
  const probe = document.createElement('canvas');
  return typeof probe.getContext === 'function' && probe.getContext('2d') !== null;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function encodeCanvasAtDimension(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  for (const attempt of ENCODING_ATTEMPTS) {
    const candidate = canvas.toDataURL(attempt.mime, attempt.quality);
    if (isDataUrlWithinBudget(candidate)) {
      return candidate;
    }
  }
  return null;
}

function compressLoadedImage(img: HTMLImageElement): string | null {
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  for (const maxDim of RESIZE_DIMENSIONS) {
    const scaled = computeScaledDimensions(srcWidth, srcHeight, maxDim);
    const compressed = encodeCanvasAtDimension(img, scaled.width, scaled.height);
    if (compressed) {
      return compressed;
    }
  }
  return null;
}

function canKeepRawImage(rawDataUrl: string, img: HTMLImageElement): boolean {
  if (!isDataUrlWithinBudget(rawDataUrl)) {
    return false;
  }
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  return width <= DEFAULT_MAX_DIMENSION && height <= DEFAULT_MAX_DIMENSION;
}

export async function prepareImageUpload(file: File): Promise<{ dataUrl: string }> {
  if (!isAllowedImageMimeType(file.type)) {
    throw new ImageCompressError('INVALID_IMAGE_FORMAT');
  }
  const rawDataUrl = await readFileAsDataUrl(file);
  if (!Number.isFinite(estimateDataUrlDecodedBytes(rawDataUrl))) {
    throw new ImageCompressError('INVALID_IMAGE_FORMAT');
  }
  if (!isCanvasSupported()) {
    if (isDataUrlWithinBudget(rawDataUrl)) {
      return { dataUrl: rawDataUrl };
    }
    throw new ImageCompressError('IMAGE_TOO_LARGE');
  }

  const img = await loadImageElement(rawDataUrl);
  if (!img) {
    throw new ImageCompressError('INVALID_IMAGE_FORMAT');
  }
  if (canKeepRawImage(rawDataUrl, img)) {
    return { dataUrl: rawDataUrl };
  }

  const compressed = compressLoadedImage(img);
  if (!compressed) {
    throw new ImageCompressError('IMAGE_TOO_LARGE');
  }
  return { dataUrl: compressed };
}
