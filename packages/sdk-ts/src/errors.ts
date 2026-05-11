/**
 * Errors thrown by the SDK. Always include the response body the
 * backend returned so callers can branch on `code` (the stable
 * machine-readable identifier) rather than parsing message text.
 */
export class MpcKitError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "MpcKitError";
  }
}

export class MpcKitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpcKitTimeoutError";
  }
}

export class MpcKitInsufficientCreditsError extends MpcKitError {
  constructor(body: unknown) {
    super("insufficient credits", 402, "INSUFFICIENT_CREDITS", body);
    this.name = "MpcKitInsufficientCreditsError";
  }
}
