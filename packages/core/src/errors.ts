/**
 * Typed error classes used across the Lambda. Each carries an HTTP status code so
 * the Hono error handler can map cleanly without leaking internals.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: string; code: string; details?: unknown } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {})
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'bad_request', details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(message, 401, 'unauthorized', details);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super(message, 404, 'not_found', details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
    this.name = 'ConflictError';
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'upstream_error', details);
    this.name = 'UpstreamError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: unknown) {
    super(message, 500, 'internal_error', details);
    this.name = 'InternalError';
  }
}
