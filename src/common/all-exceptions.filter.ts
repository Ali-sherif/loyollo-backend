import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

import { ERROR_CODES } from "./app.error";

type Envelope = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

/**
 * Normalizes every thrown error into `{ code, message, details }`
 * (docs/backend/api-contract.md#error-envelope). Unrecognized failures become a
 * generic 500 — provider names, stack traces, and SQL never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpException");

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; body: Envelope } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (this.isEnvelope(payload)) {
        return {
          status,
          body: {
            code: payload.code,
            message: payload.message,
            details: payload.details ?? {},
          },
        };
      }

      // ValidationPipe throws BadRequestException with a `message: string[]`.
      if (
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { message?: unknown }).message)
      ) {
        const errors = (payload as { message: string[] }).message;
        return {
          status,
          body: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: errors[0] ?? "Validation failed",
            details: { errors },
          },
        };
      }

      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: string })?.message ?? exception.message);

      return {
        status,
        body: {
          code: this.statusToCode(status),
          message,
          details: {},
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Something went wrong.",
        details: {},
      },
    };
  }

  private isEnvelope(payload: unknown): payload is Envelope {
    return (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Envelope).code === "string" &&
      typeof (payload as Envelope).message === "string"
    );
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.PERMISSION_DENIED;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.VALIDATION_FAILED;
      default:
        return ERROR_CODES.INTERNAL_ERROR;
    }
  }
}
