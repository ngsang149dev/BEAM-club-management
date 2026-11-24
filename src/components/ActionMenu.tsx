'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

export interface ActionMenuProps {
  readonly label: string;
  readonly children: ReactNode;
}

export function ActionMenu({ label, children }: ActionMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const el = detailsRef.current;
      if (!el?.open) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        el.open = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const el = detailsRef.current;
      if (event.key === 'Escape' && el?.open) {
        el.open = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <details
      ref={detailsRef}
      className="ui-action-menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <summary
        className="ui-icon-btn ui-action-menu-trigger"
        aria-label={label}
        title={label}
        onClick={(event) => event.stopPropagation()}
      >
        ⋯
      </summary>
      <div className="ui-action-menu-list" role="menu">
        {children}
      </div>
    </details>
  );
}

export interface ActionMenuItemProps {
  readonly children: ReactNode;
  readonly onSelect: () => void;
  readonly variant?: 'default' | 'danger';
  readonly disabled?: boolean;
}

export function ActionMenuItem({
  children,
  onSelect,
  variant = 'default',
  disabled = false,
}: ActionMenuItemProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const details = event.currentTarget.closest('details');
    if (details) details.open = false;
    onSelect();
  };

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={variant === 'danger' ? 'ui-action-menu-item is-danger' : 'ui-action-menu-item'}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

export function ActionMenuSeparator() {
  return <div className="ui-action-menu-sep" role="separator" />;
}
