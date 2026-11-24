import { QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import viMessages from '../../../messages/vi.json';
import { ClubLogo } from '@/components/ClubLogo';
import { MemberAvatar } from '@/components/MemberAvatar';
import { invalidateMyAvatarRelatedQueries } from '@/features/auth/hooks/useAuth';
import { invalidateMemberAvatarRelatedQueries } from '@/features/members/hooks/useMembers';
import { TaskAssigneeChips } from '@/features/tasks/components/TaskPriorityBadge';
import { getAvatarTone, getMemberInitials } from '@/lib/media';

describe('MemberAvatar, ClubLogo & TaskAssigneeChips', () => {
  afterEach(() => {
    vi.doUnmock('react');
    vi.doUnmock('@/features/branding/hooks/useBranding');
    vi.resetModules();
  });

  it('renders image inside .ui-avatar when avatarUrl is provided and colorful initials when absent', () => {
    const withImageHtml = renderToStaticMarkup(
      <MemberAvatar
        memberId="u-1"
        fullName="Nguyen Minh Anh"
        avatarUrl="/api/v1/members/u-1/avatar?v=1700000000000"
        size="lg"
      />
    );
    expect(withImageHtml).toContain('class="ui-avatar is-lg has-image"');
    expect(withImageHtml).toContain('src="/api/v1/members/u-1/avatar?v=1700000000000"');
    expect(withImageHtml).toContain('class="ui-avatar-img"');
    expect(withImageHtml).toContain('alt=""');

    const initialsHtml = renderToStaticMarkup(
      <MemberAvatar memberId="u-1" fullName="Nguyen Minh Anh" avatarUrl={null} size="sm" />
    );
    const tone = getAvatarTone('u-1');
    expect(initialsHtml).toContain('class="ui-avatar is-sm"');
    expect(initialsHtml).toContain(`background-color:${tone.bg}`);
    expect(initialsHtml).toContain(`color:${tone.fg}`);
    expect(initialsHtml).toContain(getMemberInitials('Nguyen Minh Anh'));
    expect(initialsHtml).not.toContain('<img');
  });

  it('renders muted .is-out styling when member is inactive', () => {
    const inactiveInitialsHtml = renderToStaticMarkup(
      <MemberAvatar memberId="u-2" fullName="Tran Quoc Bao" isActive={false} />
    );
    expect(inactiveInitialsHtml).toContain('class="ui-avatar is-out"');
    expect(inactiveInitialsHtml).not.toContain('background-color:');
    expect(inactiveInitialsHtml).toContain('TB');

    const inactiveImgHtml = renderToStaticMarkup(
      <MemberAvatar
        memberId="u-2"
        fullName="Tran Quoc Bao"
        avatarUrl="/api/v1/members/u-2/avatar?v=1"
        isActive={false}
      />
    );
    expect(inactiveImgHtml).toContain('class="ui-avatar has-image is-out"');
    expect(inactiveImgHtml).toContain('src="/api/v1/members/u-2/avatar?v=1"');
  });

  it('renders TaskAssigneeChips using MemberAvatar size="xs" with avatarUrl or initials', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <TaskAssigneeChips
          assignees={[
            {
              id: 'u-img',
              fullName: 'Le Van C',
              isActive: true,
              leftAt: null,
              departments: [],
              avatarUrl: '/api/v1/members/u-img/avatar?v=5',
            },
            {
              id: 'u-init',
              fullName: 'Pham Thi D',
              isActive: false,
              leftAt: '2026-10-01T00:00:00Z',
              departments: [],
              avatarUrl: null,
            },
          ]}
        />
      </NextIntlClientProvider>
    );

    expect(html).toContain('ui-avatar is-xs has-image');
    expect(html).toContain('/api/v1/members/u-img/avatar?v=5');
    expect(html).toContain('ui-avatar is-xs is-out');
    expect(html).toContain('PD');
    expect(html).toContain('Pham Thi D (đã rời)');
  });

  it('renders default ClubLogo badge cleanly without QueryClientProvider and custom img when logoUrl is passed', () => {
    const defaultHtml = renderToStaticMarkup(<ClubLogo alt="BEAM" />);
    expect(defaultHtml).toContain('class="ui-logo"');
    expect(defaultHtml).toContain('aria-label="BEAM"');
    expect(defaultHtml).not.toContain('<img');

    const customHtml = renderToStaticMarkup(
      <ClubLogo logoUrl="/api/v1/branding/logo?v=99" alt="BEAM Club" size="lg" />
    );
    expect(customHtml).toContain('class="club-logo-box is-lg"');
    expect(customHtml).toContain('src="/api/v1/branding/logo?v=99"');
    expect(customHtml).toContain('alt="BEAM Club"');
    expect(customHtml).toContain('class="club-logo-img"');
  });

  it('falls back on image onError and resets automatically when avatarUrl or logoUrl updates', async () => {
    vi.resetModules();
    let stateSlot: unknown = null;
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useState: (initial: unknown) => {
          if (stateSlot === null && initial !== null) {
            stateSlot = initial;
          }
          const setState = (next: unknown) => {
            stateSlot = typeof next === 'function' ? (next as (prev: unknown) => unknown)(stateSlot) : next;
          };
          return [stateSlot, setState];
        },
      };
    });

    const { MemberAvatar: StatefulAvatar } = await import('@/components/MemberAvatar');
    const urlV1 = '/api/v1/members/u-err/avatar?v=1';
    const urlV2 = '/api/v1/members/u-err/avatar?v=2';

    const firstEl = StatefulAvatar({ memberId: 'u-err', fullName: 'Hoang Nam', avatarUrl: urlV1 });
    expect(firstEl.props.className).toContain('has-image');
    const imgChild = firstEl.props.children as { type: string; props: { src: string; onError: () => void } };
    expect(imgChild.type).toBe('img');
    expect(imgChild.props.src).toBe(urlV1);

    imgChild.props.onError();
    const fallbackEl = StatefulAvatar({ memberId: 'u-err', fullName: 'Hoang Nam', avatarUrl: urlV1 });
    expect(fallbackEl.props.className).not.toContain('has-image');
    expect(fallbackEl.props.children).toBe('HN');
    expect(fallbackEl.props.style).toEqual({
      backgroundColor: getAvatarTone('u-err').bg,
      color: getAvatarTone('u-err').fg,
    });

    const recoveredEl = StatefulAvatar({ memberId: 'u-err', fullName: 'Hoang Nam', avatarUrl: urlV2 });
    expect(recoveredEl.props.className).toContain('has-image');
    const imgChildV2 = recoveredEl.props.children as { props: { src: string } };
    expect(imgChildV2.props.src).toBe(urlV2);

    stateSlot = null;
    vi.doMock('@/features/branding/hooks/useBranding', () => ({
      useOptionalClubLogoUrl: () => null,
    }));
    const { ClubLogo: StatefulLogo } = await import('@/components/ClubLogo');
    const logoV1 = '/api/v1/branding/logo?v=10';
    const logoV2 = '/api/v1/branding/logo?v=20';

    const logoFirst = StatefulLogo({ logoUrl: logoV1, alt: 'BEAM' });
    expect(logoFirst.props.className).toContain('club-logo-box');
    const logoImg = logoFirst.props.children as { props: { src: string; onError: () => void } };
    logoImg.props.onError();

    const logoFallback = StatefulLogo({ logoUrl: logoV1, alt: 'BEAM' });
    expect(logoFallback.props.className).toContain('ui-logo');

    const logoRecovered = StatefulLogo({ logoUrl: logoV2, alt: 'BEAM' });
    expect(logoRecovered.props.className).toContain('club-logo-box');
    const logoImgV2 = logoRecovered.props.children as { props: { src: string } };
    expect(logoImgV2.props.src).toBe(logoV2);
  });

  it('invalidates boardDetail, taskDetail, myTasks, assigneeMembers, me, members, and auditLogs on avatar updates', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await invalidateMyAvatarRelatedQueries(queryClient);
    const myKeys = invalidateSpy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(myKeys).toContainEqual(['auth', 'me']);
    expect(myKeys).toContainEqual(['members']);
    expect(myKeys).toContainEqual(['auditLogs']);
    expect(myKeys).toContainEqual(['boardDetail']);
    expect(myKeys).toContainEqual(['taskDetail']);
    expect(myKeys).toContainEqual(['myTasks']);
    expect(myKeys).toContainEqual(['tasks', 'assigneeMembers']);

    invalidateSpy.mockClear();
    await invalidateMemberAvatarRelatedQueries(queryClient);
    const memberKeys = invalidateSpy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(memberKeys).toContainEqual(['members']);
    expect(memberKeys).toContainEqual(['auth', 'me']);
    expect(memberKeys).toContainEqual(['auditLogs']);
    expect(memberKeys).toContainEqual(['boardDetail']);
    expect(memberKeys).toContainEqual(['taskDetail']);
    expect(memberKeys).toContainEqual(['myTasks']);
    expect(memberKeys).toContainEqual(['tasks', 'assigneeMembers']);
  });
});
