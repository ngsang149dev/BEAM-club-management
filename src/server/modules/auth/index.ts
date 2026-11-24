export type {
  DepartmentSummaryDto,
  LoginResponseDto,
  MemberDetailDto,
  MeResponseDto,
  SessionInfoResponseDto,
} from './mapper';
export {
  FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT,
  RATE_LIMIT_MAX_FAILED_ATTEMPTS,
  RATE_LIMIT_WINDOW_MINUTES,
  resolveLoginRedirect,
} from './policy';
export {
  DrizzleAuthRepository,
  type AuthRepository,
  type DepartmentRecord,
  type ProfileWithDepartmentsRecord,
  type SessionRecord,
} from './repository';
export {
  changeMyPasswordFormSchema,
  changeMyPasswordRequestSchema,
  DEFAULT_LOGIN_REDIRECT,
  loginFormSchema,
  loginRequestSchema,
  newPasswordSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordInputSchema,
  sanitizeReturnTo,
  SESSION_COOKIE_NAME,
  studentIdSchema,
  updateMeRequestSchema,
  type ChangeMyPasswordFormInput,
  type ChangeMyPasswordRequestInput,
  type LoginFormInput,
  type LoginRequestInput,
  type UpdateMeRequestInput,
} from './schemas';
export {
  AuthService,
  type AuthenticatedSession,
  type AuthServiceDeps,
  type ChangeMyPasswordCommand,
  type LoginCommand,
  type LoginResult,
  type MeResult,
  type RemoveMyAvatarCommand,
  type UpdateMyAvatarCommand,
} from './service';
