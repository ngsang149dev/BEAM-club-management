import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/features/shared/api/client';
import {
  BRAND_ASSET_FILE_ACCEPT,
  compressImageFileToDataUrl,
  computeScaledDimensions,
  estimateDataUrlDecodedBytes,
  GALLERY_IMAGE_COMPRESSION_OPTIONS,
  ImageCompressError,
  isDataUrlWithinBudget,
  LOGO_IMAGE_COMPRESSION_OPTIONS,
  MAX_GALLERY_DATA_URL_LENGTH,
  MAX_GALLERY_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  prepareImageUpload,
  resolveImageUploadErrorKey,
  WORDMARK_IMAGE_COMPRESSION_OPTIONS,
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
    expect(resolveImageUploadErrorKey(new ImageCompressError('IMAGE_TOO_LARGE', MAX_IMAGE_BYTES))).toBe('imageTooLarge');
    expect(resolveImageUploadErrorKey(new ImageCompressError('IMAGE_TOO_LARGE', MAX_GALLERY_IMAGE_BYTES))).toBe('galleryImageTooLarge');
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
    expect(
      resolveImageUploadErrorKey(
        new ApiClientError({ status: 409, code: 'GALLERY_LIMIT_REACHED', messageKey: 'errors.galleryLimitReached', details: {} })
      )
    ).toBe('galleryLimitReached');
  });

  it('supports gallery 512 KB budget and 1280/960/720 dimensions via compressImageFileToDataUrl', async () => {
    const galleryPassThrough = createFakeFile(MAX_IMAGE_BYTES + 10_000, 'gallery.png', 'image/png');
    const dataUrl = await compressImageFileToDataUrl(galleryPassThrough, GALLERY_IMAGE_COMPRESSION_OPTIONS);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(isDataUrlWithinBudget(dataUrl)).toBe(false);
    expect(
      isDataUrlWithinBudget(dataUrl, MAX_GALLERY_IMAGE_BYTES, MAX_GALLERY_DATA_URL_LENGTH)
    ).toBe(true);

    const tooLargeGallery = createFakeFile(MAX_GALLERY_IMAGE_BYTES + 1024, 'huge-gallery.png', 'image/png');
    await expect(
      compressImageFileToDataUrl(tooLargeGallery, GALLERY_IMAGE_COMPRESSION_OPTIONS)
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });

    const calls: { width: number; height: number }[] = [];
    const oversized = `data:image/webp;base64,${'A'.repeat(760_000)}`;
    const sharpGallery = `data:image/webp;base64,${'C'.repeat(8000)}`;
    const mockCtx = { clearRect: vi.fn(), drawImage: vi.fn() };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn((mime: string, quality: number) => {
        calls.push({ width: mockCanvas.width, height: mockCanvas.height });
        return mime === 'image/webp' && quality === 0.86 ? sharpGallery : oversized;
      }),
    };
    class MockHdImage {
      naturalWidth = 2560;
      naturalHeight = 1920;
      width = 2560;
      height = 1920;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => mockCanvas) });
    vi.stubGlobal('Image', MockHdImage);

    const compressed = await compressImageFileToDataUrl(
      createFakeFile(4000, 'hd.jpg', 'image/jpeg'),
      GALLERY_IMAGE_COMPRESSION_OPTIONS
    );
    expect(compressed).toBe(sharpGallery);
    expect(calls[0]).toEqual({ width: 1280, height: 960 });
  });

  it('rasterizes SVG wordmark/logo via URL.createObjectURL on a transparent canvas without black fill or jpeg fallback', async () => {
    expect(BRAND_ASSET_FILE_ACCEPT).toContain('image/svg+xml,.svg');
    expect(WORDMARK_IMAGE_COMPRESSION_OPTIONS.dimensions).toEqual([640, 480, 320]);
    expect(WORDMARK_IMAGE_COMPRESSION_OPTIONS.allowSvgRasterize).toBe(true);
    expect(WORDMARK_IMAGE_COMPRESSION_OPTIONS.preserveAlpha).toBe(true);
    expect(LOGO_IMAGE_COMPRESSION_OPTIONS.allowSvgRasterize).toBe(true);
    expect(LOGO_IMAGE_COMPRESSION_OPTIONS.preserveAlpha).toBe(true);

    const encodedAttempts: { mime: string; width: number; height: number }[] = [];
    const transparentWebp = `data:image/webp;base64,${'D'.repeat(400)}`;
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn((mime: string) => {
        encodedAttempts.push({ mime, width: mockCanvas.width, height: mockCanvas.height });
        return mime === 'image/png' ? transparentWebp.replace('image/webp', 'image/png') : transparentWebp;
      }),
    };
    class MockZeroDimensionSvgImage {
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-svg');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: vi.fn(() => mockCanvas) });
    vi.stubGlobal('Image', MockZeroDimensionSvgImage);

    const svgFile = new File(['<svg viewBox="0 0 320 100"><text>BEAM</text></svg>'], '5.svg', {
      type: 'image/svg+xml',
    });
    const output = await compressImageFileToDataUrl(svgFile, WORDMARK_IMAGE_COMPRESSION_OPTIONS);
    expect(output).toBe(transparentWebp);
    expect(createObjectUrlSpy).toHaveBeenCalledWith(svgFile);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-svg');
    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 640, 200);
    expect(mockCtx.fillRect).not.toHaveBeenCalled();
    expect(encodedAttempts[0]).toEqual({ mime: 'image/webp', width: 640, height: 200 });

    // Oversized PNG with preserveAlpha only uses webp/png encodings (never jpeg)
    const oversizedAlpha = `data:image/webp;base64,${'E'.repeat(400_000)}`;
    const alphaPng = `data:image/png;base64,${'F'.repeat(500)}`;
    const alphaCalls: string[] = [];
    class MockOversizedPngImage {
      naturalWidth = 1000;
      naturalHeight = 400;
      width = 1000;
      height = 400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockOversizedPngImage);
    mockCanvas.toDataURL = vi.fn((mime: string) => {
      alphaCalls.push(mime);
      return mime === 'image/png' ? alphaPng : oversizedAlpha;
    });
    const pngOutput = await compressImageFileToDataUrl(
      createFakeFile(1024, 'alpha.png', 'image/png'),
      WORDMARK_IMAGE_COMPRESSION_OPTIONS
    );
    expect(pngOutput).toBe(alphaPng);
    expect(alphaCalls.length).toBeGreaterThan(0);
    expect(alphaCalls.every((m) => m === 'image/webp' || m === 'image/png')).toBe(true);
    expect(alphaCalls).not.toContain('image/jpeg');
  });
});
