/**
 * Job queue types. Every async job kind has a string name + a typed
 * payload. The handler signature in `features/<x>/jobs.ts` is
 * `(payload: PayloadFor<jobName>) => Promise<void>`.
 *
 * Names are namespaced (`<feature>.<verb>`) so adding a new feature
 * doesn't collide. Payloads are minimal; the handler re-fetches what
 * it needs from the DB to keep the queue row small and the source of
 * truth in Postgres.
 */
import type { IkaNetwork } from "@/config/env";

export const JOBS = {
  presignRefill: "presigns.refill",
  presignSweepExpired: "presigns.sweep-expired",
  signProcess: "sign.process",
  signSweepPrepared: "sign.sweep-prepared",
  billingSweep: "billing.sweep",
  billingSweepRetry: "billing.sweep-retry",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface PresignRefillPayload {
  /** Sui network the refill PTB runs on. */
  network: IkaNetwork;
  curve: number;
  signatureAlgorithm: number;
  /** How many to mint in this batch. */
  count: number;
}

export interface PresignSweepExpiredPayload {
  /** Reservations older than this in seconds get rolled back to `ready`. */
  olderThanSec: number;
}

export interface SignProcessPayload {
  signRequestId: string;
}

export interface SignSweepPreparedPayload {
  /**
   * Prepared rows older than this many seconds get rolled back: their
   * presign returns to `ready`, the row is marked `failed`, and the
   * upfront credit charge is refunded.
   */
  olderThanSec: number;
}

export interface BillingSweepPayload {
  /** uuid of the user whose deposit address to drain. */
  userId: string;
  /** Sui network the deposit address lives on. */
  network: IkaNetwork;
  /**
   * Optional. When set, the sweep job will mark this deposit row's
   * `sweep_*` columns on success. When unset, the sweep is opportunistic
   * (e.g. periodic backfill) and won't update any specific deposit row.
   */
  depositId?: string;
}

export interface BillingSweepRetryPayload {
  /**
   * Re-enqueue `billing.sweep` for any deposit older than this many
   * seconds whose `sweep_status` is still `pending` or `failed`.
   * Catches sweeps lost to transient RPC/gas failures.
   */
  olderThanSec: number;
}

export type PayloadFor<N extends JobName> = N extends typeof JOBS.presignRefill
  ? PresignRefillPayload
  : N extends typeof JOBS.presignSweepExpired
    ? PresignSweepExpiredPayload
    : N extends typeof JOBS.signProcess
      ? SignProcessPayload
      : N extends typeof JOBS.signSweepPrepared
        ? SignSweepPreparedPayload
        : N extends typeof JOBS.billingSweep
          ? BillingSweepPayload
          : N extends typeof JOBS.billingSweepRetry
            ? BillingSweepRetryPayload
            : never;
