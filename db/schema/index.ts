import { boards, columns } from './boards';
import {
  appSettings,
  clubAssets,
  loginAttempts,
  loginGalleryItems,
  profiles,
  sessions,
} from './identity';
import { notifications } from './notifications';
import {
  auditLogs,
  departments,
  memberDepartments,
  permissionPresets,
  permissions,
  presetPermissions,
  userPermissions,
} from './permissions';
import {
  comments,
  reminders,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  taskEvents,
  tasks,
} from './tasks';

export {
  appSettings,
  auditLogs,
  boards,
  clubAssets,
  columns,
  comments,
  departments,
  loginAttempts,
  loginGalleryItems,
  memberDepartments,
  notifications,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
};

export const schema = {
  appSettings,
  auditLogs,
  boards,
  clubAssets,
  columns,
  comments,
  departments,
  loginAttempts,
  loginGalleryItems,
  memberDepartments,
  notifications,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
};

export type AppSchema = typeof schema;
