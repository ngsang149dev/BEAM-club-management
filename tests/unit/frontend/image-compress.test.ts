import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/features/shared/api/client';
import {
  computeScaledDimensions,
  estimateDataUrlDecodedBytes,
  ImageCompressError,
  isDataUrlWithinBudget,
  MAX_IMAGE_BYTES,
  prepareImageUpload,
  resolveImageUploadErrorKey,
} from '@/features/shared/image-compress';

function createFakeFile(byteLength: number, name: string, type: string): File {
  const bytes = new Uint8Array(byteLength);
  bytes.fill(65);
  return new File([bytes], name, { type });
}

describe('image-compress helper (CR-02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('strictly rejects SVG and unsupported MIME types with INVALID_IMAGE_FORMAT', async () => {
    const svgFile = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'bad.svg', {
      type: 'image/svg+xml',
    });
    await expect(prepareImageUpload(svgFile)).rejects.toMatchObject({
      name: 'ImageCompressError',
      code: 'INVALID_IMAGE_FORMAT',
    });

    const gifFile = createFakeFile(64, 'anim.gif', 'image/gif');
    await expect(prepareImageUpload(gifFile)).rejects.toThrow('INVALID_IMAGE_FORMAT');

    const emptyTypeFile = createFakeFile(64, 'unknown', '');
    await expect(prepareImageUpload(emptyTypeFile)).rejects.toThrow('INVALID_IMAGE_FORMAT');
  });

  it('passes through valid PNG/JPEG/WEBP within 256 KB when canvas is unavailable in Node/jsdom', async () => {
    const pngFile = createFakeFile(1024, 'avatar.png', 'image/png');
    const result = await prepareImageUpload(pngFile);
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(estimateDataUrlDecodedBytes(result.dataUrl)).toBe(1024);
    expect(isDataUrlWithinBudget(result.dataUrl)).toBe(true);

    const webpFile = createFakeFile(2048, 'logo.webp', 'image/webp');
    const webpResult = await prepareImageUpload(webpFile);
    expect(webpResult.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('throws IMAGE_TOO_LARGE when image exceeds MAX_IMAGE_BYTES and cannot be compressed', async () => {
    const hugeFile = createFakeFile(MAX_IMAGE_BYTES + 1024, 'huge.png', 'image/png');
    await expect(prepareImageUpload(hugeFile)).rejects.toMatchObject({
      name: 'ImageCompressError',
      code: 'IMAGE_TOO_LARGE',
    });
  });

  it('resizes oversized images (> 512px) and tries webp/jpeg quality ladder via canvas', async () => {
    const toDataUrlCalls: { mime: string; quality: number; width: number; height: number }[] = [];
    const oversizedCandidate = `data:image/webp;base64,${'A'.repeat(400_000)}`;
    const compactCandidate = `data:image/jpeg;base64,${'B'.repeat(4000)}`;

    const mockContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext),
      toDataURL: vi.fn((mime: string, quality: number) => {
        toDataUrlCalls.push({
          mime,
          quality,
          width: mockCanvas.width,
          height: mockCanvas.height,
        });
        if (mime === 'image/jpeg' && quality === 0.72) {
          return compactCandidate;
        }
        return oversizedCandidate;
      }),
    };

    class MockImage {
      naturalWidth = 1200;
      naturalHeight = 600;
      width = 1200;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockCanvas),
    });
    vi.stubGlobal('Image', MockImage);

    const file = createFakeFile(1500, 'photo.jpg', 'image/jpeg');
    const output = await prepareImageUpload(file);

    expect(output.dataUrl).toBe(compactCandidate);
    expect(mockContext.drawImage).toHaveBeenCalled();
    expect(toDataUrlCalls.some((c) => c.width === 512 && c.height === 256)).toBe(true);
    expect(toDataUrlCalls.some((c) => c.mime === 'image/webp' && c.quality === 0.86)).toBe(true);
    expect(toDataUrlCalls.some((c) => c.mime === 'image/jpeg' && c.quality === 0.72)).toBe(true);
  });

  it('computes scaled dimensions and resolves client/server image upload errors cleanly', () => {
    expect(computeScaledDimensions(1000, 500, 512)).toEqual({ width: 512, height: 256 });
    expect(computeScaledDimensions(400, 800, 512)).toEqual({ width: 256, height: 512 });
    expect(computeScaledDimensions(300, 300, 512)).toEqual({ width: 300, height: 300 });

    expect(resolveImageUploadErrorKey(new ImageCompressError('INVALID_IMAGE_FORMAT'))).toBe('invalidImageFormat');
    expect(resolveImageUploadErrorKey(new ImageCompressError('IMAGE_TOO_LARGE'))).toBe('imageTooLarge');
    expect(
      resolveImageUploadErrorKey(
        new ApiClientError({ status: 400, code: 'INVALID_IMAGE_FORMAT', messageKey: 'errors.invalidImageFormat', details: {} })
      )
    ).toBe('invalidImageFormat');
    expect(
      resolveImageUploadErrorKey(
        new ApiClientError({ status: 400, code: 'IMAGE_TOO_LARGE', messageKey: 'errors.imageTooLarge', details: {} })
      )
    ).toBe('imageTooLarge');
    expect(
      resolveImageUploadErrorKey(
        new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {} })
      )
    ).toBe('forbidden');
  });
});
