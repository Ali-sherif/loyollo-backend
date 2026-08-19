import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { AuthenticatedUser } from "../authenticated-user";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error("@CurrentUser() used on a route without an authenticated user");
    }
    return request.user;
  },
);

/**
 * The caller's Shop scope, taken from the validated JWT — never a path or body
 * parameter. Handlers targeting another profile must compare against this.
 */
export const CurrentOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error("@CurrentOwner() used on a route without an authenticated user");
    }
    return request.user.owner_id;
  },
);
