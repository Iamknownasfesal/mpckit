"use client";

import { Check, Fingerprint, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tile } from "@/components/dash/tile";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/toast";

const DISMISS_KEY = "mpckit:passkey-banner-dismissed";

export function AddPasskeyBanner() {
  const [state, setState] = useState<
    "loading" | "show" | "registering" | "registered" | "hidden"
  >("loading");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY)) {
      setState("hidden");
      return;
    }
    fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as unknown[]) : []))
      .then((list) => setState(list.length > 0 ? "hidden" : "show"))
      .catch(() => setState("show"));
  }, []);

  async function register() {
    setState("registering");
    try {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) {
        toastError(
          "Couldn't register passkey",
          undefined,
          res.error.message ?? "Please try again",
        );
        setState("show");
        return;
      }
      toast.success("Passkey saved", {
        description: "Next time, just sign in with passkey.",
      });
      setState("registered");
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch (e) {
      toastError("Couldn't register passkey", e);
      setState("show");
    }
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setState("hidden");
  }

  if (state === "loading" || state === "hidden") return null;

  return (
    <Tile glow="teal" dots>
      <div className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center md:p-7">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-primary/10">
            {state === "registered" ? (
              <Check className="size-5 text-primary" />
            ) : (
              <Fingerprint className="size-5 text-primary" />
            )}
          </div>
          <div className="space-y-1">
            <span className="t-kicker">One-time setup</span>
            <div className="text-[15px] font-medium tracking-tight">
              {state === "registered"
                ? "Passkey saved on this device."
                : "Skip the wallet popup next time."}
            </div>
            <div className="text-xs text-muted-foreground">
              {state === "registered"
                ? "Next time, just sign in with passkey."
                : "Register a passkey on this device for one-tap sign-in."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          {state !== "registered" ? (
            <Button
              size="sm"
              onClick={register}
              disabled={state === "registering"}
              className="rounded-full"
            >
              <Fingerprint />{" "}
              {state === "registering" ? "Awaiting…" : "Add passkey"}
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X />
          </Button>
        </div>
      </div>
    </Tile>
  );
}
