/**
 * MPCKitError carries the response body verbatim so callers can branch
 * on `code` (the stable identifier) instead of message text. Pin that
 * contract for each variant.
 */
import { describe, expect, test } from "bun:test";

import {
  MPCKitError,
  MPCKitInsufficientCreditsError,
  MPCKitTimeoutError,
} from "../src/errors";

describe("MPCKitError", () => {
  test("carries status + code + body verbatim", () => {
    const body = { code: "NOT_FOUND", error: "dwallet not found", id: "abc" };
    const err = new MPCKitError("dwallet not found", 404, "NOT_FOUND", body);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MPCKitError");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.body).toBe(body);
    expect(err.message).toBe("dwallet not found");
  });

  test("survives instanceof checks across try/catch", () => {
    try {
      throw new MPCKitError("nope", 500, "INTERNAL", null);
    } catch (e) {
      expect(e instanceof MPCKitError).toBe(true);
      expect(e instanceof Error).toBe(true);
    }
  });
});

describe("MPCKitTimeoutError", () => {
  test("is an Error subclass with name MPCKitTimeoutError", () => {
    const err = new MPCKitTimeoutError("GET /v1/sign timed out");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MPCKitTimeoutError");
    expect(err.message).toBe("GET /v1/sign timed out");
    expect(err instanceof MPCKitError).toBe(false);
  });
});

describe("MPCKitInsufficientCreditsError", () => {
  test("pins status=402 + code=INSUFFICIENT_CREDITS", () => {
    const body = { code: "INSUFFICIENT_CREDITS", error: "top up" };
    const err = new MPCKitInsufficientCreditsError(body);
    expect(err.status).toBe(402);
    expect(err.code).toBe("INSUFFICIENT_CREDITS");
    expect(err.body).toBe(body);
    expect(err.message).toBe("insufficient credits");
    expect(err.name).toBe("MPCKitInsufficientCreditsError");
  });

  test("extends MPCKitError so catch blocks targeting the base class catch it", () => {
    const err = new MPCKitInsufficientCreditsError(null);
    expect(err instanceof MPCKitError).toBe(true);
  });
});
