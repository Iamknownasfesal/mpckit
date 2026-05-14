/**
 * Toast helpers. Every TanStack `useMutation` in the dashboard had the
 * same `toast.error(title, { description: err instanceof ApiError ?
 * err.message : "Unknown error" })` pattern; centralise it here so
 * future routes don't repeat the typecheck dance.
 */
import { toast } from "sonner";
import { ApiError } from "./api";

/** Pull a user-facing description out of any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

/**
 * `toast.error` with the error's message as the description. Pass an
 * explicit `description` to override (useful when the underlying
 * error wouldn't be helpful to the user).
 */
export function toastError(
  title: string,
  err?: unknown,
  description?: string,
): void {
  toast.error(title, {
    description:
      description ?? (err === undefined ? undefined : errorMessage(err)),
  });
}
