import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to the centralized error handler via `next(err)`.
 *
 * Express 4 does not auto-catch async rejections; this bridge
 * lets handlers throw `AppError` (or any Error) and rely on the
 * global error middleware in httpApp.ts.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
