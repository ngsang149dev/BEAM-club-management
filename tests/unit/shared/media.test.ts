import { describe, expect, it } from 'vitest';
import {
  AVATAR_PALETTE,
  LOGIN_GALLERY_CAPTION_MAX,
  LOGIN_GALLERY_TITLE_MAX,
  MAX_GALLERY_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_LOGIN_GALLERY_ITEMS,
  createLoginGalleryItemRequestSchema,
  galleryCaptionSchema,
  galleryTitleSchema,
  getAvatarTone,
  getMemberInitials,
  reorderLoginGalleryRequestSchema,
  toClubLogoUrl,
  toLoginGalleryImageUrl,
  toMemberAvatarUrl,
  updateLoginGalleryItemRequestSchema,
} from '@/lib/media';
import {
  buildBinaryImageResponse,
  detectImageMimeFromMagicBytes,
  parseAndValidateImageDataUrl,
} from '@/server/shared/media';

const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const SAMPLE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SAMPLE_WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
]);

describe('shared media helpers', () => {
  it('detects magic bytes and validates PNG, JPEG, and WEBP data URLs', () => {
    expect(detectImageMimeFromMagicBytes(SAMPLE_PNG_BYTES)).toBe('image/png');
    expect(detectImageMimeFromMagicBytes(SAMPLE_JPEG_BYTES)).toBe('image/jpeg');
    expect(detectImageMimeFromMagicBytes(SAMPLE_WEBP_BYTES)).toBe('image/webp');
    expect(detectImageMimeFromMagicBytes(Buffer.from('<svg></svg>'))).toBeNull();

    const parsedPng = parseAndValidateImageDataUrl(
      `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`,
    );
    expect(parsedPng.mimeType).toBe('image/png');
    expect(parsedPng.buffer.equals(SAMPLE_PNG_BYTES)).toBe(true);

    const parsedJpeg = parseAndValidateImageDataUrl(
      `data:image/jpeg;base64,${SAMPLE_JPEG_BYTES.toString('base64')}`,
    );
    expect(parsedJpeg.mimeType).toBe('image/jpeg');

    const parsedWebp = parseAndValidateImageDataUrl(
      `data:image/webp;base64,${SAMPLE_WEBP_BYTES.toString('base64')}`,
    );
    expect(parsedWebp.mimeType).toBe('image/webp');
  });

  it('rejects SVG, mismatched spoofed MIME headers, and payloads exceeding maxBytes', () => {
    const svgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ).toString('base64');

    expect(() =>
      parseAndValidateImageDataUrl(`data:image/svg+xml;base64,${svgBase64}`),
    ).toThrow(/invalidImageFormat/);

    expect(() =>
      parseAndValidateImageDataUrl(`data:image/png;base64,${svgBase64}`),
    ).toThrow(/invalidImageFormat/);

    expect(() =>
      parseAndValidateImageDataUrl(
        `data:image/jpeg;base64,${SAMPLE_PNG_BYTES.toString('base64')}`,
      ),
    ).toThrow(/invalidImageFormat/);

    const overDefault = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(MAX_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
    ]);
    expect(() =>
      parseAndValidateImageDataUrl(
        `data:image/png;base64,${overDefault.toString('base64')}`,
      ),
    ).toThrow(/imageTooLarge/);

    const galleryValid = parseAndValidateImageDataUrl(
      `data:image/png;base64,${overDefault.toString('base64')}`,
      MAX_GALLERY_IMAGE_BYTES,
    );
    expect(galleryValid.buffer.length).toBe(MAX_IMAGE_BYTES + 1);

    const overGallery = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
    ]);
    try {
      parseAndValidateImageDataUrl(
        `data:image/png;base64,${overGallery.toString('base64')}`,
        MAX_GALLERY_IMAGE_BYTES,
      );
      expect.fail('Expected gallery payload > 512 KB to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'IMAGE_TOO_LARGE',
        details: { maxBytes: MAX_GALLERY_IMAGE_BYTES },
      });
    }
  });

  it('builds safe binary headers and deterministic avatar/logo/gallery helpers', () => {
    const res = buildBinaryImageResponse({
      data: SAMPLE_PNG_BYTES,
      mimeType: 'image/png',
    });
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");

    expect(getMemberInitials('Nguyễn Minh Khang')).toBe('NK');
    expect(getMemberInitials('Beam')).toBe('BE');
    const toneA = getAvatarTone('10000000-0000-4000-8000-000000000001');
    const toneB = getAvatarTone('10000000-0000-4000-8000-000000000001');
    expect(toneA).toEqual(toneB);
    expect(AVATAR_PALETTE).toContainEqual(toneA);

    const ts = new Date('2026-11-24T12:00:00Z');
    expect(toMemberAvatarUrl('user-1', null)).toBeNull();
    expect(toMemberAvatarUrl('user-1', ts)).toBe(`/api/v1/members/user-1/avatar?v=${ts.getTime()}`);
    expect(toClubLogoUrl(null)).toBeNull();
    expect(toClubLogoUrl(ts)).toBe(`/api/v1/branding/logo?v=${ts.getTime()}`);
    expect(toLoginGalleryImageUrl('item-1', ts)).toBe(
      `/api/v1/branding/gallery/item-1/image?v=${ts.getTime()}`,
    );
  });

  it('validates login gallery Zod schemas cleanly', () => {
    expect(galleryTitleSchema.parse('  BEAM Workshop  ')).toBe('BEAM Workshop');
    expect(() => galleryTitleSchema.parse('   ')).toThrow();
    expect(() =>
      galleryTitleSchema.parse('a'.repeat(LOGIN_GALLERY_TITLE_MAX + 1)),
    ).toThrow();

    expect(galleryCaptionSchema.parse('   ')).toBeNull();
    expect(galleryCaptionSchema.parse(null)).toBeNull();
    expect(galleryCaptionSchema.parse('  Spring event  ')).toBe('Spring event');
    expect(() =>
      galleryCaptionSchema.parse('a'.repeat(LOGIN_GALLERY_CAPTION_MAX + 1)),
    ).toThrow();

    const sampleDataUrl = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;
    expect(
      createLoginGalleryItemRequestSchema.parse({
        title: '  Hackathon  ',
        caption: '   ',
        dataUrl: sampleDataUrl,
      }),
    ).toEqual({
      title: 'Hackathon',
      caption: null,
      dataUrl: sampleDataUrl,
    });
    expect(() =>
      createLoginGalleryItemRequestSchema.parse({
        title: 'Hackathon',
        dataUrl: sampleDataUrl,
        extra: true,
      }),
    ).toThrow();

    expect(() => updateLoginGalleryItemRequestSchema.parse({})).toThrow();
    expect(updateLoginGalleryItemRequestSchema.parse({ caption: '  ' })).toEqual({
      caption: null,
    });

    const id1 = '10000000-0000-4000-8000-000000000001';
    expect(reorderLoginGalleryRequestSchema.parse({ itemIds: [id1] })).toEqual({
      itemIds: [id1],
    });
    expect(() => reorderLoginGalleryRequestSchema.parse({ itemIds: [] })).toThrow();
    expect(() =>
      reorderLoginGalleryRequestSchema.parse({
        itemIds: Array.from({ length: MAX_LOGIN_GALLERY_ITEMS + 1 }, () => id1),
      }),
    ).toThrow();
  });
});
