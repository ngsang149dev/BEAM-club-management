import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Can, PermissionsProvider, usePermissions } from '@/features/shared/permissions/can';

function PermissionProbe() {
  const { isAdmin, can, canAny } = usePermissions();
  return (
    <div
      data-admin={String(isAdmin)}
      data-board-create={String(can('board.create'))}
      data-member-any={String(canAny(['member.create', 'member.update']))}
    />
  );
}

describe('PermissionsProvider, usePermissions, and <Can>', () => {
  it('fails closed by default when no PermissionsProvider is mounted', () => {
    const html = renderToStaticMarkup(
      <>
        <PermissionProbe />
        <Can permission="board.create" fallback={<span>denied-perm</span>}>
          <span>allowed-perm</span>
        </Can>
        <Can anyOf={['member.view']} fallback={<span>denied-any</span>}>
          <span>allowed-any</span>
        </Can>
        <Can adminOnly fallback={<span>denied-admin</span>}>
          <span>allowed-admin</span>
        </Can>
      </>
    );

    expect(html).toContain('data-admin="false"');
    expect(html).toContain('data-board-create="false"');
    expect(html).toContain('data-member-any="false"');
    expect(html).toContain('denied-perm');
    expect(html).toContain('denied-any');
    expect(html).toContain('denied-admin');
    expect(html).not.toContain('allowed-perm');
    expect(html).not.toContain('allowed-any');
    expect(html).not.toContain('allowed-admin');
  });

  it('evaluates permission, anyOf, adminOnly, and empty criteria accurately', () => {
    const html = renderToStaticMarkup(
      <PermissionsProvider isAdmin={false} permissions={['board.create', 'member.update']}>
        <PermissionProbe />
        <Can permission="board.create" fallback={<span>no-board-create</span>}>
          <span>has-board-create</span>
        </Can>
        <Can permission="board.delete" fallback={<span>no-board-delete</span>}>
          <span>has-board-delete</span>
        </Can>
        <Can anyOf={['member.create', 'member.update']} fallback={<span>no-member-any</span>}>
          <span>has-member-any</span>
        </Can>
        <Can anyOf={[]} fallback={<span>empty-anyof-fallback</span>}>
          <span>empty-anyof-allowed</span>
        </Can>
        <Can adminOnly fallback={<span>non-admin-fallback</span>}>
          <span>admin-only-content</span>
        </Can>
        <Can fallback={<span>no-criteria-fallback</span>}>
          <span>no-criteria-content</span>
        </Can>
      </PermissionsProvider>
    );

    expect(html).toContain('data-board-create="true"');
    expect(html).toContain('data-member-any="true"');
    expect(html).toContain('has-board-create');
    expect(html).toContain('no-board-delete');
    expect(html).toContain('has-member-any');
    expect(html).toContain('empty-anyof-fallback');
    expect(html).toContain('non-admin-fallback');
    expect(html).toContain('no-criteria-fallback');
    expect(html).not.toContain('has-board-delete');
    expect(html).not.toContain('admin-only-content');
    expect(html).not.toContain('no-criteria-content');
  });

  it('grants all permission, anyOf, and adminOnly checks when isAdmin is true', () => {
    const html = renderToStaticMarkup(
      <PermissionsProvider isAdmin permissions={[]}>
        <PermissionProbe />
        <Can permission="audit.view" fallback={<span>denied-audit</span>}>
          <span>allowed-audit</span>
        </Can>
        <Can anyOf={['task.delete']} fallback={<span>denied-task-del</span>}>
          <span>allowed-task-del</span>
        </Can>
        <Can adminOnly fallback={<span>denied-admin-only</span>}>
          <span>allowed-admin-only</span>
        </Can>
      </PermissionsProvider>
    );

    expect(html).toContain('data-admin="true"');
    expect(html).toContain('data-board-create="true"');
    expect(html).toContain('data-member-any="true"');
    expect(html).toContain('allowed-audit');
    expect(html).toContain('allowed-task-del');
    expect(html).toContain('allowed-admin-only');
  });
});
