import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type MessageTree = { [key: string]: string | MessageTree };

function loadMessages(locale: 'vi' | 'en'): MessageTree {
  const filePath = path.resolve(process.cwd(), 'messages', `${locale}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as MessageTree;
}

function collectLeafEntries(node: MessageTree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.set(fullKey, value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of collectLeafEntries(value, fullKey)) {
        entries.set(nestedKey, nestedValue);
      }
    } else {
      throw new Error(`Invalid i18n value type at key "${fullKey}"`);
    }
  }
  return entries;
}

describe('i18n message dictionaries (vi/en)', () => {
  it('maintains recursive key parity between vi.json and en.json', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const viKeys = [...viEntries.keys()].sort();
    const enKeys = [...enEntries.keys()].sort();

    expect(enKeys).toEqual(viKeys);
  });

  it('contains no empty or whitespace-only string values', () => {
    for (const locale of ['vi', 'en'] as const) {
      const entries = collectLeafEntries(loadMessages(locale));
      for (const [key, value] of entries) {
        expect(value.trim().length, `${locale}:${key} must be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('includes all required E1-03 foundation namespaces and tokens', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const requiredKeys = [
      'app.name',
      'app.title',
      'nav.boards',
      'nav.myTasks',
      'nav.members',
      'nav.profile',
      'nav.memberAdmin',
      'nav.permissions',
      'nav.departments',
      'nav.reminders',
      'nav.auditLog',
      'nav.drawerAriaLabel',
      'common.loading',
      'common.retry',
      'common.cancel',
      'common.save',
      'common.close',
      'common.backToBoards',
      'common.goHome',
      'common.signInAgain',
      'common.undo',
      'priority.low',
      'priority.medium',
      'priority.high',
      'priority.urgent',
      'member.leftBadge',
      'language.vi',
      'language.en',
      'home.title',
      'errors.requestIdLabel',
      'errors.validation',
      'errors.401.title',
      'errors.403.title',
      'errors.404.title',
      'errors.409.title',
      'errors.429.title',
      'errors.500.title',
      'errors.offline.title',
      'errors.sessionExpired.title',
    ];

    for (const key of requiredKeys) {
      expect(viEntries.has(key), `Missing vi key: ${key}`).toBe(true);
      expect(enEntries.has(key), `Missing en key: ${key}`).toBe(true);
    }

    expect(viEntries.get('member.leftBadge')).toBe('(đã rời)');
    expect(enEntries.get('member.leftBadge')).toBe('(left)');
  });
});
