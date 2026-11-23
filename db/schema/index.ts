import { boards, columns } from './boards';
import { appSettings, loginAttempts, profiles, sessions } from './identity';
import {
  auditLogs,
  departments,
  memberDepartments,
  permissionPresets,
  permissions,
  presetPermissions,
  userPermissions,
} from './permissions';
import { comments, reminders, taskAssignees, taskEvents, tasks } from './tasks';

export {
  appSettings,
  auditLogs,
  boards,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskEvents,
  tasks,
  userPermissions,
};

export const schema = {
  appSettings,
  auditLogs,
  boards,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskEvents,
  tasks,
  userPermissions,
};

export type AppSchema = typeof schema;
