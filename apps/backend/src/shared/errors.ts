/**
 * Shared error type. Throwing an `AppError` from anywhere (route,
 * service, worker) lets the HTTP layer map it to a stable
 * `{error, code}` JSON shape with a known status code, and lets the
 * worker layer log + retry policy use the same `code`.
 *
 * For 4xx-class predictable failures use `AppError`. For unexpected
 * 5xx, throw a normal `Error` and the HTTP layer will return a 500.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public override readonly cause?: unknown;

  constructor(status: number, message: string, code: string, cause?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.cause = cause;
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: (message = "unauthorized", code = "UNAUTHORIZED") =>
    new AppError(401, message, code),
  forbidden: (message = "forbidden", code = "FORBIDDEN") =>
    new AppError(403, message, code),
  notFound: (message = "not found", code = "NOT_FOUND") =>
    new AppError(404, message, code),
  conflict: (message: string, code = "CONFLICT") =>
    new AppError(409, message, code),
  validation: (message: string, code = "VALIDATION") =>
    new AppError(400, message, code),
  rateLimited: (message = "rate limit exceeded", code = "RATE_LIMITED") =>
    new AppError(429, message, code),
  paymentRequired: (message = "payment required", code = "PAYMENT_REQUIRED") =>
    new AppError(402, message, code),
  unprocessable: (message: string, code = "UNPROCESSABLE") =>
    new AppError(422, message, code),
  internal: (
    message = "internal error",
    code = "INTERNAL_ERROR",
    cause?: unknown,
  ) => new AppError(500, message, code, cause),
  notConfigured: (what: string) =>
    new AppError(503, `${what} not configured`, "NOT_CONFIGURED"),
  unavailable: (message: string, code = "SERVICE_UNAVAILABLE") =>
    new AppError(503, message, code),
};
