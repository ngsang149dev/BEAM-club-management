import { coreScreens } from './core.mjs';
import { adminScreens } from './admin.mjs';
import { systemScreens } from './system.mjs';

export const screens = [...coreScreens, ...adminScreens, ...systemScreens].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
