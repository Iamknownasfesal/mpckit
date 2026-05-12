/**
 * Errors thrown by the SDK. Always include the response body the
 * backend returned so callers can branch on `code` (the stable
 * machine-readable identifier) rather than parsing message text.
 */
export class MPCKitError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "MPCKitError";
  }
}

export class MPCKitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MPCKitTimeoutError";
  }
}

export class MPCKitInsufficientCreditsError extends MPCKitError {
  constructor(body: unknown) {
    super("insufficient credits", 402, "INSUFFICIENT_CREDITS", body);
    this.name = "MPCKitInsufficientCreditsError";
  }
}
