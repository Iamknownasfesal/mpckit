"use client";

import {
  useCurrentAccount,
  useDisconnectWallet,
  useSignPersonalMessage,
} from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import { AlertTriangle, Fingerprint, Github, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GrainBg } from "@/components/dash/shaders";
import { StatusPill } from "@/components/dash/status-pill";
import { WalletPickerDialog } from "@/components/dash/wallet-picker";
import { Mark } from "@/components/mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient, signIn, useSession } from "@/lib/auth-client";
import { shortSuiAddress } from "@/lib/identity";

const POST_SIGNIN = "/overview";

export default function SignInPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { mutateAsync: disconnect } = useDisconnectWallet();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"github" | "passkey" | "sui" | null>(
    null,
  );
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  async function switchWallet() {
    if (account) {
      try {
        await disconnect();
      } catch {
        // ignore – we open the picker either way
      }
    }
    setWalletModalOpen(true);
  }

  useEffect(() => {
    if (!isPending && session?.user) router.replace(POST_SIGNIN);
  }, [isPending, session, router]);

  async function continueWithGitHub() {
    setError(null);
    setPending("github");
    try {
      // Better-Auth resolves a relative callbackURL against its own
      // baseURL (api.mpckit.xyz), which would land us on the backend
      // origin. Anchor it to the dashboard origin instead.
      const callbackURL =
        typeof window !== "undefined"
          ? `${window.location.origin}${POST_SIGNIN}`
          : POST_SIGNIN;
      await signIn.social({ provider: "github", callbackURL });
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub sign-in failed");
      setPending(null);
    }
  }

  async function continueWithPasskey() {
    setError(null);
    setPending("passkey");
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        const code = (res.error as { code?: string }).code;
        if (code === "PASSKEY_NOT_FOUND" || res.error.status === 401) {
          setError(
            "No passkey on this device yet. Sign in with your Sui wallet first, then add a passkey from Settings.",
          );
        } else {
          setError(res.error.message ?? "Passkey sign-in failed");
        }
        setPending(null);
        return;
      }
      router.replace(POST_SIGNIN);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey sign-in failed");
      setPending(null);
    }
  }

  async function continueWithSui() {
    if (!account) {
      setWalletModalOpen(true);
      return;
    }
    setError(null);
    setPending("sui");
    try {
      const nonceRes = await fetch("/api/auth/siws/nonce", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address }),
      });
      if (!nonceRes.ok) {
        throw new Error((await nonceRes.text()) || "couldn't issue nonce");
      }
      const { message } = (await nonceRes.json()) as {
        nonce: string;
        message: string;
      };

      const { signature } = await signPersonalMessage({
        message: new TextEncoder().encode(message),
      });

      const verifyRes = await fetch("/api/auth/siws/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          message,
          signature,
        }),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? "signature rejected");
      }
      toast.success("Signed in");
      window.location.href = POST_SIGNIN;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sui sign-in failed");
      setPending(null);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12 md:px-8">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 dot-ledger dot-ledger-fade opacity-60"
      />

      <div className="grid w-full max-w-[1200px] grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative hidden overflow-hidden rounded-3xl border bg-card/40 lg:block"
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
            <GrainBg
              colors={["#0a8c8b", "#2dd4d2", "#0c1a1a"]}
              colorBack="#000000"
              softness={0.85}
              intensity={0.55}
              noise={0.45}
              shape="dots"
              speed={0.45}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 dot-ledger dot-ledger-fade"
          />
          <div className="relative z-10 flex h-full flex-col justify-between gap-10 p-10 xl:p-14">
            <div className="space-y-7">
              <div className="flex items-center gap-3">
                <Mark size={32} />
                <span className="text-base font-semibold tracking-tight">
                  MPCKit
                </span>
              </div>
              <StatusPill tone="live" pulse>
                Live on Sui testnet + mainnet
              </StatusPill>
              <h2 className="text-balance text-[40px] font-semibold leading-[0.98] tracking-[-0.035em] xl:text-[52px]">
                Sign on every chain.
                <br />
                <span className="text-primary">From one API.</span>
              </h2>
              <p className="max-w-[44ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
                Hosted MPC signing for crypto products. Bitcoin, Ethereum,
                Solana, Sui, and every chain those four curves cover, from one
                HTTP call.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border/60">
              {[
                ["Curves", "4"],
                ["Settled on", "Sui"],
                ["Holds keys?", "No."],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex flex-col gap-1 bg-background/85 p-4 backdrop-blur-md"
                >
                  <span className="t-kicker">{k}</span>
                  <span className="t-mono text-xl font-medium tracking-tight">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.aside>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: "easeOut" }}
          className="flex items-center"
        >
          <div className="w-full">
            <div className="mx-auto flex max-w-md flex-col gap-3 lg:hidden">
              <Mark size={36} />
            </div>
            <div className="mx-auto mt-6 max-w-md space-y-2 lg:mt-0">
              <span className="t-kicker">Sign in</span>
              <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] md:text-[40px]">
                Pick up where you left off.
              </h1>
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                Sign in with a Sui wallet, GitHub, or a passkey on this device.
                We never hold your keys, and there's no password to lose.
              </p>
            </div>

            <div className="mx-auto mt-8 max-w-md rounded-2xl border bg-card/70 p-1.5 shadow-2xl shadow-black/30 backdrop-blur-md">
              <div className="rounded-xl border bg-background p-5">
                <div className="flex flex-col gap-2.5">
                  <Button
                    size="lg"
                    onClick={continueWithSui}
                    disabled={pending !== null}
                    className="h-11 rounded-full"
                  >
                    <Wallet />
                    {pending === "sui"
                      ? "Awaiting signature…"
                      : account
                        ? `Sign in as ${shortSuiAddress(account.address)}`
                        : "Sign in with Sui wallet"}
                  </Button>
                  {account ? (
                    <button
                      type="button"
                      onClick={switchWallet}
                      disabled={pending !== null}
                      className="t-mono -mt-1 self-center text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Use a different wallet
                    </button>
                  ) : null}

                  <div className="my-3 flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="t-kicker">or</span>
                    <Separator className="flex-1" />
                  </div>

                  <Button
                    variant="outline"
                    size="lg"
                    onClick={continueWithGitHub}
                    disabled={pending !== null}
                    className="h-11 rounded-full"
                  >
                    <Github />
                    {pending === "github"
                      ? "Opening GitHub…"
                      : "Continue with GitHub"}
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    onClick={continueWithPasskey}
                    disabled={pending !== null}
                    className="h-11 rounded-full"
                  >
                    <Fingerprint />
                    {pending === "passkey"
                      ? "Authenticating…"
                      : "Sign in with passkey"}
                  </Button>
                </div>

                {error ? (
                  <Alert variant="destructive" className="mt-4">
                    <AlertTriangle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </div>

            <p className="mx-auto mt-8 max-w-md text-center text-xs text-muted-foreground">
              By continuing you accept the{" "}
              <a
                href="https://docs.mpckit.xyz/terms"
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                terms
              </a>{" "}
              and{" "}
              <a
                href="https://docs.mpckit.xyz/privacy"
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                privacy policy
              </a>
              .
            </p>

            <WalletPickerDialog
              open={walletModalOpen}
              onOpenChange={setWalletModalOpen}
            />
          </div>
        </motion.div>
      </div>
    </main>
  );
}
