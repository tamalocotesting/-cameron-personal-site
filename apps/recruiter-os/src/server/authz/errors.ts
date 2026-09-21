/**
 * Error types the whole server shares.
 *
 * `NotFoundError` is deliberately what an unauthorized read returns to a
 * caller who has no business knowing the row exists. `ForbiddenError` is only
 * used where the caller may legitimately know the subject exists but lacks a
 * specific grant — and its message names the grant, so the UI can explain the
 * block instead of showing a dead control.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(subject = 'Record') {
    super(`${subject} not found.`, 'not_found', 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string,
    readonly requiredGrant?: string,
  ) {
    super(message, 'forbidden', 403);
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super('Sign in to continue.', 'unauthenticated', 401);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, 'validation', 400);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'conflict', 409);
  }
}

/** A blocked action that is a configuration or policy state, not an error. */
export class BlockedError extends AppError {
  constructor(
    message: string,
    readonly blockReason: string,
  ) {
    super(message, 'blocked', 409);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
