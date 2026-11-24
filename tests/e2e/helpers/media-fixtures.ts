import { deflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';
import { AVATAR_PALETTE, MAX_IMAGE_BYTES, getAvatarTone, getMemberInitials } from '@/lib/media';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBytes, crcInput, crcBytes]);
}

export function createSolidPngBuffer(
  width = 16,
  height = 16,
  rgba: readonly [number, number, number, number] = [219, 39, 119, 255],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 4;
  const rawPixels = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowStride;
    rawPixels[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      rawPixels[px] = rgba[0];
      rawPixels[px + 1] = rgba[1];
      rawPixels[px + 2] = rgba[2];
      rawPixels[px + 3] = rgba[3];
    }
  }

  const compressed = deflateSync(rawPixels);
  return Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function createCanvasWebpBuffer(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    ctx.fillStyle = '#0F766E';
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(6, 6, 12, 12);
    return canvas.toDataURL('image/webp', 0.9);
  });
  const base64 = dataUrl.split(',')[1];
  if (!base64 || !dataUrl.startsWith('data:image/webp;base64,')) {
    throw new Error(`Expected data:image/webp;base64,... from canvas, got: ${dataUrl.slice(0, 32)}`);
  }
  return Buffer.from(base64, 'base64');
}

export function createOversizedPngDataUrl(): string {
  const basePng = createSolidPngBuffer(8, 8);
  const padding = Buffer.alloc(MAX_IMAGE_BYTES + 1 - basePng.length, 0x01);
  return `data:image/png;base64,${Buffer.concat([basePng, padding]).toString('base64')}`;
}

export const SVG_PAYLOAD_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
);

export function hexToRgbString(hex: string): string {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

export async function expectColorfulInitialsAvatar(
  avatarLocator: Locator,
  memberId: string,
  fullName: string,
): Promise<void> {
  await expect(avatarLocator).toBeVisible();
  await expect(avatarLocator).not.toHaveClass(/has-image/);
  await expect(avatarLocator.locator('img')).toHaveCount(0);
  await expect(avatarLocator).toHaveText(getMemberInitials(fullName));

  const expectedTone = getAvatarTone(memberId);
  const expectedRgb = hexToRgbString(expectedTone.bg);
  expect(AVATAR_PALETTE.map((tone) => hexToRgbString(tone.bg))).toContain(expectedRgb);

  const inlineBg = await avatarLocator.evaluate((el) => (el as HTMLElement).style.backgroundColor);
  expect(inlineBg).toBe(expectedRgb);
}

export async function expectLoadedAvatarImage(
  avatarLocator: Locator,
  expectedSrcPrefix: string,
): Promise<string> {
  await expect(avatarLocator).toBeVisible();
  await expect(avatarLocator).toHaveClass(/has-image/);
  const img = avatarLocator.locator('img.ui-avatar-img');
  await expect(img).toBeVisible();
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  expect(src?.startsWith(expectedSrcPrefix)).toBe(true);
  await expect
    .poll(async () =>
      img.evaluate((el) => {
        const image = el as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  return src!;
}

export async function expectLoadedLogoImage(imgLocator: Locator): Promise<string> {
  await expect(imgLocator).toBeVisible();
  const src = await imgLocator.getAttribute('src');
  expect(src).toMatch(/^\/api\/v1\/branding\/logo\?v=\d+$/);
  await expect
    .poll(async () =>
      imgLocator.evaluate((el) => {
        const image = el as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  return src!;
}

export function expectSafeBinaryHeaders(headers: Record<string, string>, expectedMime: string): void {
  expect(headers['content-type']).toBe(expectedMime);
  expect(headers['x-content-type-options']).toBe('nosniff');
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain('sandbox');
}
