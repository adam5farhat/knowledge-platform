/**
 * Typed application error that carries an HTTP status code and an optional
 * machine-readable `code` field.  Throw from any route or lib function;
 * the centralized Express error handler in httpApp.ts maps it to a JSON response.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, code?: string, details?: unknown): AppError {
    return new AppError(400, message, code, details);
  }

  static unauthorized(message: string, code?: string): AppError {
    return new AppError(401, message, code);
  }

  static forbidden(message: string, code?: string): AppError {
    return new AppError(403, message, code);
  }

  static notFound(message: string, code?: string): AppError {
    return new AppError(404, message, code);
  }

  static conflict(message: string, code?: string): AppError {
    return new AppError(409, message, code);
  }
}
