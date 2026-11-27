import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  clubAssets,
  loginAttempts,
  loginGalleryItems,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { MAX_GALLERY_IMAGE_BYTES, MAX_IMAGE_BYTES, MAX_LOGIN_GALLERY_ITEMS } from '@/lib/media';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import viMessages from '../../messages/vi.json';
import {
  SVG_PAYLOAD_BYTES,
  createCanvasWebpBuffer,
  createSolidPngBuffer,
  expectLoadedLogoImage,
  expectSafeBinaryHeaders,
} from './helpers/media-fixtures';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];

const SVG_WORDMARK_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 100" width="320" height="100">' +
    '<rect x="8" y="16" width="60" height="68" rx="14" fill="#DB2777"/>' +
    '<text x="86" y="64" font-family="sans-serif" font-size="44" font-weight="800" fill="#111827">BEAM</text>' +
    '</svg>',
  'utf8',
);
const GIF_PAYLOAD_BYTES = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');

function createOversizedDataUrl(maxBytes: number): string {
  const basePng = createSolidPngBuffer(8, 8);
  const padding = Buffer.alloc(maxBytes + 1 - basePng.length, 0x01);
  return `data:image/png;base64,${Buffer.concat([basePng, padding]).toString('base64')}`;
}

function assertNoSecretsInText(payload: string, secrets: readonly string[]): void {
  expect(payload).not.toContain('passwordHash');
  expect(payload).not.toContain('password_hash');
  expect(payload).not.toContain('scrypt$');
  expect(payload).not.toContain('data:image/');
  expect(payload).not.toContain('"studentId"');
  expect(payload).not.toContain('"email"');
  for (const secret of secrets) {
    expect(payload).not.toContain(secret);
  }
}

async function attachRuntimeErrorTracker(page: Page): Promise<{
  assertClean: () => Promise<void>;
}> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const win = window as Window & { __beamUnhandledRejections?: string[] };
    win.__beamUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      win.__beamUnhandledRejections?.push(String(event.reason));
    });
  });

  return {
    assertClean: async () => {
      const unhandled = await page.evaluate(() => {
        const win = window as Window & { __beamUnhandledRejections?: string[] };
        return win.__beamUnhandledRejections ?? [];
      });
      expect(pageErrors).toEqual([]);
      expect(unhandled).toEqual([]);
    },
  };
}

async function signInAs(
  page: Page,
  studentId: string,
  returnTo = '/tasks',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

async function expectImageLoaded(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect
    .poll(async () =>
      img.evaluate((el) => {
        const image = el as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

async function expectLoginCollabFooter(page: Page): Promise<void> {
  const footer = page.locator('.login-foot');
  await expect(footer).toBeVisible();
  const beamLink = footer.getByRole('link', { name: 'BEAM CLUB', exact: true });
  const sangLink = footer.getByRole('link', { name: 'Sang', exact: true });
  await expect(beamLink).toBeVisible();
  await expect(beamLink).toHaveAttribute('href', 'https://www.facebook.com/eiu.beam.club');
  await expect(beamLink).toHaveAttribute('target', '_blank');
  await expect(beamLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(sangLink).toBeVisible();
  await expect(sangLink).toHaveAttribute('href', 'https://www.facebook.com/ng.sanggg149');
  await expect(sangLink).toHaveAttribute('target', '_blank');
  await expect(sangLink).toHaveAttribute('rel', 'noopener noreferrer');
}

test.describe('Branding Console & Login Polaroid Gallery E2E (CR-07)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const hrMemberUserId = randomUUID();
  const adminStudentId = `MSSV-BR-ADM-${suffix}`;
  const hrMemberStudentId = `MSSV-BR-HR-${suffix}`;
  const adminEmail = `branding-adm-${suffix}@eiu.edu.vn`;
  const hrMemberEmail = `branding-hr-${suffix}@eiu.edu.vn`;

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
    await db.delete(loginGalleryItems);

    await db
      .insert(permissions)
      .values([
        { code: 'member.view', groupName: 'members', description: 'View directory', scopable: false },
        { code: 'member.update', groupName: 'members', description: 'Update member', scopable: false },
        { code: 'task.update_assigned', groupName: 'tasks', description: 'Update assigned tasks', scopable: false },
        { code: 'comment.create', groupName: 'comments', description: 'Create comments', scopable: false },
      ])
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: adminUserId,
        studentId: adminStudentId,
        email: adminEmail,
        fullName: `Branding Admin ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: hrMemberUserId,
        studentId: hrMemberStudentId,
        email: hrMemberEmail,
        fullName: `Branding HR ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: hrMemberUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: hrMemberUserId, permissionCode: 'member.update', grantedBy: adminUserId },
      { userId: hrMemberUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: hrMemberUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [adminStudentId, hrMemberStudentId]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const cleanupIds = [adminUserId, hrMemberUserId];
      await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
      await db.delete(loginGalleryItems);
      await db.delete(sessions).where(inArray(sessions.userId, cleanupIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, cleanupIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [adminStudentId, hrMemberStudentId]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
        .where(eq(profiles.id, hrMemberUserId));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminUserId)));
      if (remainingAdmins.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
          .where(eq(profiles.id, adminUserId));
      }
    }
    await pool?.end();
  });

  test('enforces admin-only RBAC on /admin/branding sidebar, page 403, and all branding API endpoints', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const pngDataUrl = `data:image/png;base64,${createSolidPngBuffer(16, 16).toString('base64')}`;

    // Create one item as admin so PATCH/DELETE/order target a real UUID
    await signInAs(page, adminStudentId, '/admin/branding');
    const seedCreateRes = await page.request.post('/api/v1/branding/gallery', {
      data: { title: `RBAC Target ${suffix}`, caption: 'Test', dataUrl: pngDataUrl },
    });
    expect(seedCreateRes.status()).toBe(201);
    const createdJson = (await seedCreateRes.json()) as { item: { id: string } };
    const targetId = createdJson.item.id;

    try {
      const hrContext = await browser.newContext();
      const hrPage = await hrContext.newPage();
      const hrTracker = await attachRuntimeErrorTracker(hrPage);
      try {
        await signInAs(hrPage, hrMemberStudentId, '/members');
        await expect(
          hrPage.locator('.app-side').getByRole('link', { name: viMessages.nav.branding, exact: true }),
        ).toHaveCount(0);

        await hrPage.goto('/admin/branding');
        const forbiddenState = hrPage.locator('[data-component="ErrorState"]');
        await expect(forbiddenState).toBeVisible();
        await expect(forbiddenState.locator('.ui-state-title')).toContainText(viMessages.errors['403'].title);
        await expect(forbiddenState.locator('.ui-state-body')).toContainText(viMessages.errors['403'].description);
        await expect(forbiddenState.locator('.ui-state-meta')).toContainText(viMessages.errors['403'].code);

        const emptyWordmarkRes = await hrPage.request.get('/api/v1/branding/wordmark');
        expect(emptyWordmarkRes.status()).toBe(404);

        const forbiddenResponses = await Promise.all([
          hrPage.request.post('/api/v1/branding/gallery', {
            data: { title: 'Blocked', dataUrl: pngDataUrl },
          }),
          hrPage.request.patch(`/api/v1/branding/gallery/${targetId}`, {
            data: { title: 'Blocked Edit' },
          }),
          hrPage.request.delete(`/api/v1/branding/gallery/${targetId}`),
          hrPage.request.put('/api/v1/branding/gallery/order', {
            data: { itemIds: [targetId] },
          }),
          hrPage.request.put('/api/v1/branding/logo', {
            data: { dataUrl: pngDataUrl },
          }),
          hrPage.request.delete('/api/v1/branding/logo'),
          hrPage.request.put('/api/v1/branding/wordmark', {
            data: { dataUrl: pngDataUrl },
          }),
          hrPage.request.delete('/api/v1/branding/wordmark'),
        ]);

        for (const response of forbiddenResponses) {
          expect(response.status()).toBe(403);
          expect(JSON.parse(await response.text())).toMatchObject({ error: { code: 'FORBIDDEN' } });
        }

        await hrTracker.assertClean();
      } finally {
        await hrContext.close();
      }
    } finally {
      await db.delete(loginGalleryItems);
    }

    await tracker.assertClean();
  });

  test('manages club logo & login gallery CRUD, validation, reorder, limit 12, and safe audit_logs on /admin/branding', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const logoPng = createSolidPngBuffer(20, 20, [219, 39, 119, 255]);
    const logoBase64 = logoPng.toString('base64');
    const framePng = createSolidPngBuffer(24, 24, [15, 118, 110, 255]);
    const frameBase64 = framePng.toString('base64');
    const frameDataUrl = `data:image/png;base64,${frameBase64}`;
    const frameReplacePng = createSolidPngBuffer(24, 24, [124, 58, 237, 255]);
    const frameReplaceBase64 = frameReplacePng.toString('base64');
    const svgDataUrl = `data:image/svg+xml;base64,${SVG_PAYLOAD_BYTES.toString('base64')}`;
    const spoofedPngDataUrl = `data:image/png;base64,${SVG_PAYLOAD_BYTES.toString('base64')}`;

    await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
    await db.delete(loginGalleryItems);

    try {
      await signInAs(page, adminStudentId, '/tasks');
      const brandingNavLink = page
        .locator('.app-side')
        .getByRole('link', { name: viMessages.nav.branding, exact: true });
      await expect(brandingNavLink).toBeVisible();
      await brandingNavLink.click();
      await page.waitForURL(`${BASE_ORIGIN}/admin/branding`);

      // 1. Club Logo: default badge, API/UI validation, upload, security headers, AppShell + /login reflection, and remove
      const logoSection = page.locator('section.admin-card', { hasText: viMessages.branding.modalTitle });
      await expect(logoSection).toContainText(viMessages.branding.defaultBadgeActive);
      await expect(
        logoSection.getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true }),
      ).toBeDisabled();

      for (const badLogo of [svgDataUrl, spoofedPngDataUrl, createOversizedDataUrl(MAX_IMAGE_BYTES)]) {
        const res = await page.request.put('/api/v1/branding/logo', { data: { dataUrl: badLogo } });
        expect(res.status()).toBe(400);
      }

      await logoSection.locator('input[type="file"]').setInputFiles({
        name: 'bad-logo.gif',
        mimeType: 'image/gif',
        buffer: GIF_PAYLOAD_BYTES,
      });
      await expect(logoSection.locator('.ui-banner.is-danger')).toContainText(
        viMessages.errors.invalidImageFormat,
      );

      const putLogoPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/branding/logo') && res.request().method() === 'PUT',
      );
      await logoSection.locator('input[type="file"]').setInputFiles({
        name: 'beam-logo.png',
        mimeType: 'image/png',
        buffer: logoPng,
      });
      const putLogoRes = await putLogoPromise;
      expect(putLogoRes.status()).toBe(200);
      const putLogoJson = (await putLogoRes.json()) as { logoUrl: string | null };
      expect(putLogoJson.logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=\d+$/);

      await expect(logoSection).toContainText(viMessages.branding.customLogoActive);
      const shellLogoSrc = await expectLoadedLogoImage(page.locator('.app-side .app-brand img.club-logo-img'));
      expect(shellLogoSrc).toBe(putLogoJson.logoUrl);

      const getLogoRes = await page.request.get('/api/v1/branding/logo');
      expect(getLogoRes.status()).toBe(200);
      expectSafeBinaryHeaders(getLogoRes.headers(), 'image/png');

      const anonContext = await browser.newContext();
      const anonPage = await anonContext.newPage();
      const anonTracker = await attachRuntimeErrorTracker(anonPage);
      try {
        await anonPage.goto('/login');
        expect(await expectLoadedLogoImage(anonPage.locator('.login-left img.club-logo-img'))).toBe(
          putLogoJson.logoUrl,
        );
        await expect(anonPage.locator('.login-mobile-brand img.club-logo-img')).toHaveAttribute(
          'src',
          putLogoJson.logoUrl!,
        );

        const delLogoPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/v1/branding/logo') && res.request().method() === 'DELETE',
        );
        await logoSection
          .getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true })
          .click();
        expect((await delLogoPromise).status()).toBe(200);
        await expect(logoSection).toContainText(viMessages.branding.defaultBadgeActive);
        await expect(page.locator('.app-side .app-brand .ui-logo i')).toHaveCount(4);

        await anonPage.reload();
        await expect(anonPage.locator('.login-left .ui-logo i')).toHaveCount(4);
        await expect(anonPage.locator('.login-left img.club-logo-img')).toHaveCount(0);
        await anonTracker.assertClean();
      } finally {
        await anonContext.close();
      }

      // 2. Login Gallery: empty state, API/UI validation (>512 KB, SVG), create PNG + WEBP, edit, reorder, limit 12, delete
      const gallerySection = page.locator('section.admin-card', {
        hasText: viMessages.branding.gallery.sectionTitle,
      });
      await expect(gallerySection).toContainText('0 / 12');
      await expect(gallerySection).toContainText(viMessages.branding.gallery.emptyTitle);

      for (const badGalleryPayload of [
        svgDataUrl,
        spoofedPngDataUrl,
        createOversizedDataUrl(MAX_GALLERY_IMAGE_BYTES),
      ]) {
        const res = await page.request.post('/api/v1/branding/gallery', {
          data: { title: 'Invalid', dataUrl: badGalleryPayload },
        });
        expect(res.status()).toBe(400);
      }

      await gallerySection.getByRole('button', { name: viMessages.branding.gallery.addButton, exact: true }).click();
      const createModal = page.getByRole('dialog');
      await createModal.locator('input[type="file"]').setInputFiles({
        name: 'bad.svg',
        mimeType: 'image/svg+xml',
        buffer: SVG_PAYLOAD_BYTES,
      });
      await expect(createModal.locator('.ui-banner.is-danger')).toContainText(
        viMessages.errors.invalidImageFormat,
      );

      const frame1Title = `Frame One ${suffix}`;
      const frame1Caption = `Caption One ${suffix}`;
      const createFrame1Promise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/branding/gallery') && res.request().method() === 'POST',
      );
      await createModal.locator('input[type="file"]').setInputFiles({
        name: 'frame-1.png',
        mimeType: 'image/png',
        buffer: framePng,
      });
      await createModal.getByLabel(viMessages.branding.gallery.titleLabel, { exact: true }).fill(frame1Title);
      await createModal.getByLabel(viMessages.branding.gallery.captionLabel, { exact: true }).fill(frame1Caption);
      await createModal.getByRole('button', { name: viMessages.branding.gallery.createSubmit, exact: true }).click();
      const createFrame1Res = await createFrame1Promise;
      expect(createFrame1Res.status()).toBe(201);
      const frame1Json = (await createFrame1Res.json()) as { item: { id: string } };

      const frame1ImageRes = await page.request.get(`/api/v1/branding/gallery/${frame1Json.item.id}/image`);
      expect(frame1ImageRes.status()).toBe(200);
      expectSafeBinaryHeaders(frame1ImageRes.headers(), 'image/png');

      await expect(gallerySection).toContainText('1 / 12');
      const card1 = gallerySection.locator('article.gallery-admin-card', { hasText: frame1Title });
      await expect(card1).toContainText('#1');
      await expect(card1).toContainText(frame1Caption);
      await expectImageLoaded(card1.locator('img.gallery-admin-thumb'));

      // Create Frame 2 (WEBP, optional caption omitted)
      const webpBuffer = await createCanvasWebpBuffer(page);
      const webpBase64 = webpBuffer.toString('base64');
      const frame2Title = `Frame Two ${suffix}`;
      await gallerySection.getByRole('button', { name: viMessages.branding.gallery.addButton, exact: true }).click();
      const createModal2 = page.getByRole('dialog');
      const createFrame2Promise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/branding/gallery') && res.request().method() === 'POST',
      );
      await createModal2.locator('input[type="file"]').setInputFiles({
        name: 'frame-2.webp',
        mimeType: 'image/webp',
        buffer: webpBuffer,
      });
      await createModal2.getByLabel(viMessages.branding.gallery.titleLabel, { exact: true }).fill(frame2Title);
      await createModal2.getByRole('button', { name: viMessages.branding.gallery.createSubmit, exact: true }).click();
      const createFrame2Res = await createFrame2Promise;
      expect(createFrame2Res.status()).toBe(201);
      const frame2Json = (await createFrame2Res.json()) as { item: { id: string } };
      await expect(gallerySection).toContainText('2 / 12');

      const frame2ImageRes = await page.request.get(`/api/v1/branding/gallery/${frame2Json.item.id}/image`);
      expect(frame2ImageRes.status()).toBe(200);
      expectSafeBinaryHeaders(frame2ImageRes.headers(), 'image/webp');

      // Verify JPEG format upload is also accepted and served with safe headers
      const jpegDataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context missing');
        ctx.fillStyle = '#DB2777';
        ctx.fillRect(0, 0, 16, 16);
        return canvas.toDataURL('image/jpeg', 0.9);
      });
      const jpegCreateRes = await page.request.post('/api/v1/branding/gallery', {
        data: { title: `JPEG Check ${suffix}`, dataUrl: jpegDataUrl },
      });
      expect(jpegCreateRes.status()).toBe(201);
      const jpegCreatedJson = (await jpegCreateRes.json()) as { item: { id: string } };
      const jpegGetRes = await page.request.get(`/api/v1/branding/gallery/${jpegCreatedJson.item.id}/image`);
      expect(jpegGetRes.status()).toBe(200);
      expectSafeBinaryHeaders(jpegGetRes.headers(), 'image/jpeg');
      const jpegDelRes = await page.request.delete(`/api/v1/branding/gallery/${jpegCreatedJson.item.id}`);
      expect(jpegDelRes.status()).toBe(200);

      // Edit Frame 2 (title, caption, photo)
      const frame2EditedTitle = `Frame Two Edited ${suffix}`;
      const frame2EditedCaption = `Updated Caption ${suffix}`;
      const card2 = gallerySection.locator('article.gallery-admin-card', { hasText: frame2Title });
      await card2.getByRole('button', { name: viMessages.branding.gallery.editAction, exact: true }).click();
      const editModal = page.getByRole('dialog');
      const patchPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/branding/gallery/${frame2Json.item.id}`) &&
          res.request().method() === 'PATCH',
      );
      await editModal.locator('input[type="file"]').setInputFiles({
        name: 'frame-2-replaced.png',
        mimeType: 'image/png',
        buffer: frameReplacePng,
      });
      await editModal.getByLabel(viMessages.branding.gallery.titleLabel, { exact: true }).fill(frame2EditedTitle);
      await editModal.getByLabel(viMessages.branding.gallery.captionLabel, { exact: true }).fill(frame2EditedCaption);
      await editModal.getByRole('button', { name: viMessages.branding.gallery.editSubmit, exact: true }).click();
      expect((await patchPromise).status()).toBe(200);

      const editedCard2 = gallerySection.locator('article.gallery-admin-card', { hasText: frame2EditedTitle });
      await expect(editedCard2).toContainText(frame2EditedCaption);
      await expectImageLoaded(editedCard2.locator('img.gallery-admin-thumb'));

      // Reorder: move #2 left -> becomes #1
      const reorderPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/branding/gallery/order') && res.request().method() === 'PUT',
      );
      await editedCard2
        .getByRole('button', {
          name: viMessages.branding.gallery.moveLeftLabel.replace('{title}', frame2EditedTitle),
          exact: true,
        })
        .click();
      expect((await reorderPromise).status()).toBe(200);

      await expect(gallerySection.locator('article.gallery-admin-card').nth(0)).toContainText(frame2EditedTitle);
      await expect(gallerySection.locator('article.gallery-admin-card').nth(1)).toContainText(frame1Title);

      // Mismatched reorder payload rejected with 400 INVALID_GALLERY_ORDER
      const badOrderRes = await page.request.put('/api/v1/branding/gallery/order', {
        data: { itemIds: [frame1Json.item.id] },
      });
      expect(badOrderRes.status()).toBe(400);
      expect(JSON.parse(await badOrderRes.text())).toMatchObject({
        error: { code: 'INVALID_GALLERY_ORDER' },
      });

      // Fill up to 12 items and verify UI 12 / 12 + disabled Add button + 409 GALLERY_LIMIT_REACHED
      const createdExtraIds: string[] = [];
      for (let index = 3; index <= MAX_LOGIN_GALLERY_ITEMS; index += 1) {
        const res = await page.request.post('/api/v1/branding/gallery', {
          data: {
            title: `Extra Frame ${index} ${suffix}`,
            caption: `Extra Caption ${index}`,
            dataUrl: frameDataUrl,
          },
        });
        expect(res.status()).toBe(201);
        const body = (await res.json()) as { item: { id: string } };
        createdExtraIds.push(body.item.id);
      }

      const overflowRes = await page.request.post('/api/v1/branding/gallery', {
        data: { title: 'Item 13', dataUrl: frameDataUrl },
      });
      expect(overflowRes.status()).toBe(409);
      expect(JSON.parse(await overflowRes.text())).toMatchObject({
        error: { code: 'GALLERY_LIMIT_REACHED' },
      });

      await page.reload();
      await expect(gallerySection).toContainText('12 / 12');
      await expect(gallerySection).toContainText(
        viMessages.branding.gallery.limitReachedHint.replace('{max}', String(MAX_LOGIN_GALLERY_ITEMS)),
      );
      await expect(
        gallerySection.getByRole('button', { name: viMessages.branding.gallery.addButton, exact: true }),
      ).toBeDisabled();

      // Delete the 12th frame via UI -> count drops to 11 / 12 and Add button re-enables
      const lastTitle = `Extra Frame 12 ${suffix}`;
      const lastCard = gallerySection.locator('article.gallery-admin-card', { hasText: lastTitle });
      await lastCard.getByRole('button', { name: viMessages.branding.gallery.deleteAction, exact: true }).click();
      const deleteModal = page.getByRole('dialog');
      await expect(deleteModal).toContainText(lastTitle);
      const deletePromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/branding/gallery/${createdExtraIds.at(-1)}`) &&
          res.request().method() === 'DELETE',
      );
      await deleteModal
        .getByRole('button', { name: viMessages.branding.gallery.deleteConfirm, exact: true })
        .click();
      expect((await deletePromise).status()).toBe(200);

      await expect(gallerySection).toContainText('11 / 12');
      await expect(
        gallerySection.getByRole('button', { name: viMessages.branding.gallery.addButton, exact: true }),
      ).toBeEnabled();

      // 3. Audit logs record branding.logo_* and branding.gallery_* without binary data or PII
      await page.goto('/admin/audit');
      await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();

      const forbiddenAuditArtifacts = [
        logoBase64,
        frameBase64,
        frameReplaceBase64,
        webpBase64,
        adminStudentId,
        hrMemberStudentId,
        adminEmail,
        hrMemberEmail,
      ];

      for (const item of [
        { action: 'branding.logo_updated', label: viMessages.auditLogs.actions.brandingLogoUpdated },
        { action: 'branding.logo_removed', label: viMessages.auditLogs.actions.brandingLogoRemoved },
        { action: 'branding.gallery_item_created', label: viMessages.auditLogs.actions.brandingGalleryCreated },
        { action: 'branding.gallery_item_updated', label: viMessages.auditLogs.actions.brandingGalleryUpdated },
        { action: 'branding.gallery_reordered', label: viMessages.auditLogs.actions.brandingGalleryReordered },
        { action: 'branding.gallery_item_deleted', label: viMessages.auditLogs.actions.brandingGalleryDeleted },
      ]) {
        const respPromise = page.waitForResponse(
          (res) =>
            res.url().includes('/api/v1/audit-logs') &&
            res.url().includes(`action=${item.action}`) &&
            res.status() === 200,
        );
        await page.getByLabel(viMessages.auditLogs.actionFilterLabel, { exact: true }).selectOption(item.action);
        const rawBody = await (await respPromise).text();
        assertNoSecretsInText(rawBody, forbiddenAuditArtifacts);
        await expect(page.locator('.audit-table tbody tr', { hasText: item.label }).first()).toBeVisible();
      }
    } finally {
      await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
      await db.delete(loginGalleryItems);
    }

    await tracker.assertClean();
  });

  test('uploads .svg wordmark as safe raster binary, renders across AppShell and /login desktop/mobile, restores default, and logs clean audit_logs', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const svgDataUrl = `data:image/svg+xml;base64,${SVG_WORDMARK_BYTES.toString('base64')}`;

    await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));

    try {
      await signInAs(page, adminStudentId, '/admin/branding');
      const wordmarkSection = page.locator('section.admin-card', {
        hasText: viMessages.branding.wordmarkTitle,
      });
      await expect(wordmarkSection).toContainText(viMessages.branding.defaultWordmarkActive);
      await expect(
        wordmarkSection.getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true }),
      ).toBeDisabled();

      // Raw API still strictly rejects SVG data URLs
      const rawSvgRes = await page.request.put('/api/v1/branding/wordmark', {
        data: { dataUrl: svgDataUrl },
      });
      expect(rawSvgRes.status()).toBe(400);
      expect(JSON.parse(await rawSvgRes.text())).toMatchObject({
        error: { code: 'INVALID_IMAGE_FORMAT' },
      });

      // Empty wordmark returns 404 before upload
      expect((await page.request.get('/api/v1/branding/wordmark')).status()).toBe(404);

      // Client-side SVG upload rasterizes 5.svg into transparent PNG/WEBP <= 256 KB
      const putWordmarkPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/branding/wordmark') && res.request().method() === 'PUT',
      );
      await wordmarkSection.locator('input[type="file"]').setInputFiles({
        name: '5.svg',
        mimeType: 'image/svg+xml',
        buffer: SVG_WORDMARK_BYTES,
      });
      const putWordmarkRes = await putWordmarkPromise;
      expect(putWordmarkRes.status()).toBe(200);

      const sentPayload = JSON.parse(putWordmarkRes.request().postData() ?? '{}') as { dataUrl?: string };
      expect(sentPayload.dataUrl).toMatch(/^data:image\/(webp|png);base64,/);
      const sentBase64 = (sentPayload.dataUrl ?? '').split(',')[1] ?? '';
      expect(Buffer.from(sentBase64, 'base64').byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES);

      const putWordmarkJson = (await putWordmarkRes.json()) as { wordmarkUrl: string | null };
      expect(putWordmarkJson.wordmarkUrl).toMatch(/^\/api\/v1\/branding\/wordmark\?v=\d+$/);
      await expect(wordmarkSection).toContainText(viMessages.branding.customWordmarkActive);
      await expect(
        wordmarkSection.getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true }),
      ).toBeEnabled();

      // GET /api/v1/branding/wordmark returns safe raster binary with strict security headers
      const getWordmarkRes = await page.request.get('/api/v1/branding/wordmark');
      expect(getWordmarkRes.status()).toBe(200);
      const wordmarkContentType = getWordmarkRes.headers()['content-type'];
      expect(['image/webp', 'image/png']).toContain(wordmarkContentType);
      expectSafeBinaryHeaders(getWordmarkRes.headers(), wordmarkContentType!);
      const wordmarkBytes = await getWordmarkRes.body();
      expect(wordmarkBytes.byteLength).toBeGreaterThan(0);
      expect(wordmarkBytes.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
      const isPngBytes = wordmarkBytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const isWebpBytes =
        wordmarkBytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        wordmarkBytes.subarray(8, 12).toString('ascii') === 'WEBP';
      expect(isPngBytes || isWebpBytes).toBe(true);

      // Sidebar AppShell displays wordmark img next to club logo
      const shellBrand = page.locator('.app-side .app-brand');
      await expect(shellBrand.locator('.ui-logo')).toBeVisible();
      const shellWordmarkImg = shellBrand.locator('img.club-wordmark-img');
      await expectImageLoaded(shellWordmarkImg);
      await expect(shellWordmarkImg).toHaveAttribute('src', putWordmarkJson.wordmarkUrl!);

      // /login Desktop (1280x720) & /login Mobile (390x844) both display custom wordmark img
      const anonDesktopContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const anonDesktopPage = await anonDesktopContext.newPage();
      const anonDesktopTracker = await attachRuntimeErrorTracker(anonDesktopPage);
      const anonMobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const anonMobilePage = await anonMobileContext.newPage();
      const anonMobileTracker = await attachRuntimeErrorTracker(anonMobilePage);
      try {
        await anonDesktopPage.goto('/login');
        const desktopWord = anonDesktopPage.locator('.login-left .login-word');
        await expect(desktopWord.locator('.ui-logo')).toBeVisible();
        await expectImageLoaded(desktopWord.locator('img.club-wordmark-img'));
        await expect(desktopWord.locator('img.club-wordmark-img')).toHaveAttribute(
          'src',
          putWordmarkJson.wordmarkUrl!,
        );

        await anonMobilePage.goto('/login');
        const mobileWord = anonMobilePage.locator('.login-mobile-brand');
        await expect(mobileWord.locator('.ui-logo')).toBeVisible();
        await expectImageLoaded(mobileWord.locator('img.club-wordmark-img'));
        await expect(mobileWord.locator('img.club-wordmark-img')).toHaveAttribute(
          'src',
          putWordmarkJson.wordmarkUrl!,
        );

        // Restore default wordmark -> text fallback BEAM returns everywhere
        const delWordmarkPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/v1/branding/wordmark') && res.request().method() === 'DELETE',
        );
        await wordmarkSection
          .getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true })
          .click();
        expect((await delWordmarkPromise).status()).toBe(200);
        await expect(wordmarkSection).toContainText(viMessages.branding.defaultWordmarkActive);
        await expect(
          wordmarkSection.getByRole('button', { name: viMessages.branding.restoreDefaultButton, exact: true }),
        ).toBeDisabled();

        await expect(shellBrand.locator('img.club-wordmark-img')).toHaveCount(0);
        await expect(shellBrand.locator('.app-brand-text')).toContainText(viMessages.app.name);
        expect((await page.request.get('/api/v1/branding/wordmark')).status()).toBe(404);

        await anonDesktopPage.reload();
        await expect(desktopWord.locator('img.club-wordmark-img')).toHaveCount(0);
        await expect(desktopWord).toContainText(viMessages.app.name);

        await anonMobilePage.reload();
        await expect(mobileWord.locator('img.club-wordmark-img')).toHaveCount(0);
        await expect(mobileWord).toContainText(viMessages.app.name);

        await anonDesktopTracker.assertClean();
        await anonMobileTracker.assertClean();
      } finally {
        await anonDesktopContext.close();
        await anonMobileContext.close();
      }

      // Audit logs record clean branding.wordmark_updated & branding.wordmark_removed with zero binary/PII
      await page.goto('/admin/audit');
      await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();
      const forbiddenWordmarkAuditArtifacts = [
        sentBase64,
        SVG_WORDMARK_BYTES.toString('utf8'),
        SVG_WORDMARK_BYTES.toString('base64'),
        adminStudentId,
        hrMemberStudentId,
        adminEmail,
        hrMemberEmail,
      ];
      for (const item of [
        { action: 'branding.wordmark_updated', label: viMessages.auditLogs.actions.brandingWordmarkUpdated },
        { action: 'branding.wordmark_removed', label: viMessages.auditLogs.actions.brandingWordmarkRemoved },
      ]) {
        const respPromise = page.waitForResponse(
          (res) =>
            res.url().includes('/api/v1/audit-logs') &&
            res.url().includes(`action=${item.action}`) &&
            res.status() === 200,
        );
        await page.getByLabel(viMessages.auditLogs.actionFilterLabel, { exact: true }).selectOption(item.action);
        const rawBody = await (await respPromise).text();
        assertNoSecretsInText(rawBody, forbiddenWordmarkAuditArtifacts);
        await expect(page.locator('.audit-table tbody tr', { hasText: item.label }).first()).toBeVisible();
      }
    } finally {
      await db.delete(clubAssets).where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
    }

    await tracker.assertClean();
  });

  test('renders 4 sample Polaroid frames when empty, switches to ordered real frames on desktop (1280x720) with arrow + mouse drag, and hides on mobile (390x844)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await db.delete(loginGalleryItems);

    try {
      // 1. Desktop 1280x720 with empty gallery -> 4 sample Polaroid frames
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/login');
      const loginLeft = page.locator('.login-left');
      await expect(loginLeft).toBeVisible();
      await expect(loginLeft.locator('.login-photo-wall-count')).toContainText('4 khung ảnh');
      await expect(loginLeft.locator('figure.login-polaroid-card')).toHaveCount(4);
      await expect(loginLeft.locator('svg.login-polaroid-svg')).toHaveCount(4);
      await expect(loginLeft).toContainText(viMessages.auth.showcase.samples.kickoff.title);
      await expect(loginLeft).toContainText(viMessages.auth.showcase.samples.community.title);
      await expectLoginCollabFooter(page);

      // 2. Admin uploads 5 frames -> /login renders ONLY real frames in orderIndex order
      const adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      const uploadedFrames = [
        { title: `Polaroid Alpha ${suffix}`, caption: `Caption Alpha ${suffix}`, rgba: [219, 39, 119, 255] as const },
        { title: `Polaroid Beta ${suffix}`, caption: `Caption Beta ${suffix}`, rgba: [15, 118, 110, 255] as const },
        { title: `Polaroid Gamma ${suffix}`, caption: `Caption Gamma ${suffix}`, rgba: [124, 58, 237, 255] as const },
        { title: `Polaroid Delta ${suffix}`, caption: `Caption Delta ${suffix}`, rgba: [29, 78, 216, 255] as const },
        { title: `Polaroid Epsilon ${suffix}`, caption: `Caption Epsilon ${suffix}`, rgba: [180, 83, 9, 255] as const },
      ];
      try {
        await signInAs(adminPage, adminStudentId, '/admin/branding');
        for (const frame of uploadedFrames) {
          const dataUrl = `data:image/png;base64,${createSolidPngBuffer(32, 32, frame.rgba).toString('base64')}`;
          const res = await adminPage.request.post('/api/v1/branding/gallery', {
            data: { title: frame.title, caption: frame.caption, dataUrl },
          });
          expect(res.status()).toBe(201);
        }
      } finally {
        await adminContext.close();
      }

      const imageResponses: { url: string; status: number }[] = [];
      page.on('response', (res) => {
        if (res.url().includes('/api/v1/branding/gallery/') && res.url().includes('/image')) {
          imageResponses.push({ url: res.url(), status: res.status() });
        }
      });

      await page.reload();
      await expect(loginLeft.locator('.login-photo-wall-count')).toContainText('5 khung ảnh');
      await expect(loginLeft.locator('svg.login-polaroid-svg')).toHaveCount(0);
      await expect(loginLeft).not.toContainText(viMessages.auth.showcase.samples.kickoff.title);

      const cards = loginLeft.locator('figure.login-polaroid-card');
      await expect(cards).toHaveCount(5);

      for (let idx = 0; idx < uploadedFrames.length; idx += 1) {
        const card = cards.nth(idx);
        await expect(card).toContainText(uploadedFrames[idx]!.title);
        await expect(card).toContainText(uploadedFrames[idx]!.caption);
        await expectImageLoaded(card.locator('img.login-polaroid-img'));
      }
      expect(imageResponses.length).toBeGreaterThanOrEqual(5);
      for (const imgRes of imageResponses) {
        expect(imgRes.status).toBe(200);
      }

      const track = loginLeft.locator('.login-photo-wall-track');
      const overflowInfo = await track.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(overflowInfo.scrollWidth).toBeGreaterThan(overflowInfo.clientWidth);

      // 3. Clicking Next arrow (>) pans the track smoothly
      await loginLeft.locator('.login-photo-wall').hover();
      const beforeArrowScroll = await track.evaluate((el) => el.scrollLeft);
      await loginLeft.getByRole('button', { name: viMessages.auth.showcase.nextPhoto, exact: true }).click();
      await expect
        .poll(async () => track.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(beforeArrowScroll);

      // 4. Horizontal mouse pointer drag pans the track
      await page.reload();
      await expectImageLoaded(cards.first().locator('img.login-polaroid-img'));
      const box = await track.boundingBox();
      expect(box).not.toBeNull();
      const startX = box!.x + box!.width * 0.75;
      const startY = box!.y + box!.height * 0.5;
      await page.mouse.move(startX, startY);
      const beforeDragScroll = await track.evaluate((el) => el.scrollLeft);
      await page.mouse.down();
      await page.mouse.move(startX - 200, startY, { steps: 10 });
      await page.mouse.up();
      await expect
        .poll(async () => track.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(beforeDragScroll);

      // 5. Mobile 390x844 hides .login-left gallery completely and login form works normally
      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const mobilePage = await mobileContext.newPage();
      const mobileTracker = await attachRuntimeErrorTracker(mobilePage);
      try {
        await mobilePage.goto('/login');
        await expect(mobilePage.locator('.login-left')).not.toBeVisible();
        await expectLoginCollabFooter(mobilePage);
        await expect(mobilePage.getByLabel(viMessages.auth.studentIdLabel, { exact: true })).toBeVisible();
        await mobilePage.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(hrMemberStudentId);
        await mobilePage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(DEV_SEED_PASSWORD);
        await mobilePage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
        await mobilePage.waitForURL(`${BASE_ORIGIN}/tasks`);
        await mobileTracker.assertClean();
      } finally {
        await mobileContext.close();
      }
    } finally {
      await db.delete(loginGalleryItems);
    }

    await tracker.assertClean();
  });
});
