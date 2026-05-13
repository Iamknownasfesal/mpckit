/**
 * Pin `AppError` + the `errors.*` factory. The HTTP layer maps thrown
 * AppErrors to `{error, code}` JSON with the carried status; the worker
 * layer keys retry behavior off `code`. So both fields are part of the
 * stable contract.
 */
import { describe, expect, test } from "bun:test";

import { AppError, errors } from "@/shared/errors";

describe("AppError constructor", () => {
  test("stores status, message, code, cause + Error inheritance", () => {
    const cause = new Error("underlying");
    const err = new AppError(404, "no such dwallet", "NOT_FOUND", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("no such dwallet");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.cause).toBe(cause);
  });

  test("cause is optional", () => {
    const err = new AppError(400, "bad input", "VALIDATION");
    expect(err.cause).toBeUndefined();
  });

  test("survives instanceof checks across try/catch", () => {
    try {
      throw new AppError(500, "boom", "INTERNAL_ERROR");
    } catch (e) {
      expect(e instanceof AppError).toBe(true);
      expect(e instanceof Error).toBe(true);
    }
  });
});

describe("errors factory functions", () => {
  test("unauthorized → 401/UNAUTHORIZED", () => {
    const e = errors.unauthorized();
    expect(e.status).toBe(401);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("unauthorized");
  });

  test("forbidden → 403/FORBIDDEN", () => {
    expect(errors.forbidden().status).toBe(403);
    expect(errors.forbidden().code).toBe("FORBIDDEN");
  });

  test("notFound → 404/NOT_FOUND", () => {
    expect(errors.notFound().status).toBe(404);
    expect(errors.notFound().code).toBe("NOT_FOUND");
  });

  test("conflict → 409", () => {
    expect(errors.conflict("api key in use").status).toBe(409);
    expect(errors.conflict("api key in use").code).toBe("CONFLICT");
  });

  test("validation → 400/VALIDATION", () => {
    expect(errors.validation("bad payload").status).toBe(400);
    expect(errors.validation("bad payload").code).toBe("VALIDATION");
  });

  test("rateLimited → 429/RATE_LIMITED", () => {
    expect(errors.rateLimited().status).toBe(429);
    expect(errors.rateLimited().code).toBe("RATE_LIMITED");
  });

  test("paymentRequired → 402/PAYMENT_REQUIRED", () => {
    expect(errors.paymentRequired().status).toBe(402);
    expect(errors.paymentRequired().code).toBe("PAYMENT_REQUIRED");
  });

  test("unprocessable → 422", () => {
    expect(errors.unprocessable("bad state").status).toBe(422);
    expect(errors.unprocessable("bad state").code).toBe("UNPROCESSABLE");
  });

  test("internal → 500/INTERNAL_ERROR, accepts cause", () => {
    const cause = new Error("downstream blew up");
    const e = errors.internal("something failed", "X_FAIL", cause);
    expect(e.status).toBe(500);
    expect(e.code).toBe("X_FAIL");
    expect(e.message).toBe("something failed");
    expect(e.cause).toBe(cause);
  });

  test("notConfigured → 503/NOT_CONFIGURED with explanatory message", () => {
    const e = errors.notConfigured("hot wallet");
    expect(e.status).toBe(503);
    expect(e.code).toBe("NOT_CONFIGURED");
    expect(e.message).toBe("hot wallet not configured");
  });

  test("unavailable → 503/SERVICE_UNAVAILABLE", () => {
    expect(errors.unavailable("price feed offline").status).toBe(503);
    expect(errors.unavailable("price feed offline").code).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });

  test("custom code overrides default", () => {
    const e = errors.validation("bad sig", "BAD_SIG");
    expect(e.code).toBe("BAD_SIG");
  });
});
