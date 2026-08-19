import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Error codes in the project envelope (`docs/backend/api-contract.md#error-envelope`).
 * Add a code here before using it — never emit an undeclared string.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN_ROLE: "FORBIDDEN_ROLE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ACCOUNT_NOT_ACTIVE: "ACCOUNT_NOT_ACTIVE",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_ALREADY_EXISTS: "ACCOUNT_ALREADY_EXISTS",
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  INVALID_TOKEN: "INVALID_TOKEN",
  INVALID_INVITATION: "INVALID_INVITATION",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  RATE_LIMIT_STORE_UNAVAILABLE: "RATE_LIMIT_STORE_UNAVAILABLE",
  SERVICE_UNHEALTHY: "SERVICE_UNHEALTHY",
  MESSAGING_SEND_FAILED: "MESSAGING_SEND_FAILED",
  SMS_TRANSPORT_NOT_CONFIGURED: "SMS_TRANSPORT_NOT_CONFIGURED",
  SMS_CAMPAIGNS_NOT_AVAILABLE_PHASE1: "SMS_CAMPAIGNS_NOT_AVAILABLE_PHASE1",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Throw this instead of Nest's built-in exceptions so every response carries the
 * `{ code, message, details }` envelope the frontend contract expects.
 */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static unauthorized(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message, details);
  }

  static forbidden(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.FORBIDDEN, code, message, details);
  }

  static notFound(message = "Not found", details?: Record<string, unknown>) {
    return new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, message, details);
  }

  static conflict(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.CONFLICT, code, message, details);
  }

  static tooManyRequests(message: string, retryAfterSeconds: number) {
    return new AppError(
      HttpStatus.TOO_MANY_REQUESTS,
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message,
      { retry_after_seconds: retryAfterSeconds },
    );
  }

  static serviceUnavailable(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, code, message, details);
  }
}
