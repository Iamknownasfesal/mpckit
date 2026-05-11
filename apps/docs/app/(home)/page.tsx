import { Mark } from "@/components/mark";
import { DASHBOARD_URL } from "@/lib/site";
import Link from "next/link";
import { DitherBg, GrainBg, HalftoneBg } from "./_components/shaders";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col">
      <Hero />
      <StatStrip />
      <CryptographyTile />
      <SingleApiAndSui />
      <PricingAndEngineers />
      <ClosingCTA />
      <SiteFooter />
    </main>
  );
}

/* ============================================================
   HERO. bordered shell, animated grain-gradient backdrop
   ============================================================ */
function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-[1400px] px-4 pt-10 md:px-8 md:pt-14">
      <div className="relative overflow-hidden rounded-3xl border bg-fd-card/40">
        {/* WebGL grain-gradient, animated, brand-tinted */}
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
        {/* fumadocs-flavored dotted ledger overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--color-fd-foreground) 16%, transparent) 1px, transparent 1.5px)",
            backgroundSize: "14px 14px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 30%, #000 0%, transparent 90%)",
          }}
        />

        <div className="relative z-10 grid grid-cols-1 gap-12 px-6 py-16 md:grid-cols-12 md:gap-10 md:px-12 md:py-24">
          <div className="md:col-span-7">
            <span className="t-mono inline-flex items-center gap-2 rounded-full border bg-fd-card/70 px-3 py-1.5 text-[11.5px] uppercase tracking-[0.16em] text-fd-muted-foreground backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Live on Sui mainnet
              <span className="text-fd-muted-foreground/60">·</span>
              powered by 2PC-MPC
            </span>

            <h1 className="mt-9 text-balance text-[44px] font-semibold leading-[0.95] tracking-[-0.04em] md:text-[88px]">
              Sign on every chain.
              <br />
              <span className="text-fd-primary">From one API.</span>
            </h1>

            <p className="mt-7 max-w-[52ch] text-pretty text-base leading-relaxed text-fd-muted-foreground md:text-[18px]">
              MpcKit is the signing API your wallet, exchange, or app calls to
              send funds across chains. Bitcoin, Ethereum, Solana, Sui, and
              every chain those four curves cover, from one HTTP call. We never
              hold your users' keys. Neither do you.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href={DASHBOARD_URL}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
              >
                Open dashboard
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/docs/guide/quickstart"
                className="inline-flex h-11 items-center gap-2 rounded-full border bg-fd-card/70 px-5 text-sm font-medium text-fd-foreground backdrop-blur-md transition-colors hover:bg-fd-accent"
              >
                Read the docs
              </Link>
              <Link
                href="https://eprint.iacr.org/2024/253"
                className="inline-flex h-11 items-center gap-2 rounded-full px-1 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                2PC-MPC paper
                <span aria-hidden>↗</span>
              </Link>
            </div>
          </div>

          <aside className="md:col-span-5">
            <div className="rounded-2xl border bg-fd-card/80 p-1.5 shadow-2xl shadow-black/30 backdrop-blur-md">
              <div className="rounded-xl border bg-fd-background">
                <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
                  <span className="size-2 rounded-full bg-rose-400" />
                  <span className="size-2 rounded-full bg-amber-400" />
                  <span className="size-2 rounded-full bg-emerald-400" />
                  <span className="t-mono ms-3 text-[11px] text-fd-muted-foreground">
                    sign.ts
                  </span>
                  <span className="t-mono ms-auto text-[10.5px] text-fd-muted-foreground">
                    ✓
                  </span>
                </div>
                <pre className="t-mono px-4 py-4 text-[12px] leading-[1.7]">
                  <span className="text-fd-muted-foreground">
                    {"// hosted MPC, runs on Sui mainnet"}
                  </span>
                  {"\n"}
                  <span className="text-pink-500 dark:text-pink-300">
                    import
                  </span>{" "}
                  {"{ MpcKit, Curve }"}{" "}
                  <span className="text-pink-500 dark:text-pink-300">from</span>{" "}
                  <span className="text-emerald-600 dark:text-emerald-300">
                    "@mpckit/sdk"
                  </span>
                  ;{"\n\n"}
                  <span className="text-pink-500 dark:text-pink-300">
                    const
                  </span>{" "}
                  api ={" "}
                  <span className="text-pink-500 dark:text-pink-300">new</span>{" "}
                  <span className="text-blue-600 dark:text-blue-300">
                    MpcKit
                  </span>
                  (...);
                  {"\n\n"}
                  <span className="text-pink-500 dark:text-pink-300">
                    const
                  </span>{" "}
                  sig ={" "}
                  <span className="text-pink-500 dark:text-pink-300">
                    await
                  </span>{" "}
                  api.
                  <span className="text-blue-600 dark:text-blue-300">sign</span>
                  ({"{"}
                  {"\n  "}
                  <span className="text-fd-foreground">curve</span>:{" "}
                  Curve.SECP256K1,
                  {"\n  "}
                  <span className="text-fd-foreground">dwalletId</span>,{" "}
                  <span className="text-fd-foreground">message</span>,{"\n  "}
                  <span className="text-fd-foreground">
                    userSecretKeyShareHex
                  </span>
                  ,{"\n});"}
                </pre>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t px-1 pt-5">
              <span className="t-mono text-[10.5px] uppercase tracking-[0.18em] text-fd-muted-foreground">
                Both halves required
              </span>
              <span className="t-mono text-[10.5px] uppercase tracking-[0.18em] text-fd-muted-foreground">
                Zero-trust
              </span>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   STAT STRIP. 3 large stats
   ============================================================ */
function StatStrip() {
  const stats = [
    {
      kicker: "Curves",
      big: "4",
      unit: "SECP256K1, ED25519, SECP256R1, RISTRETTO",
    },
    { kicker: "Settled on", big: "Sui", unit: "mainnet" },
    { kicker: "Holds your key?", big: "No.", unit: "Neither do we." },
  ];
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-14 md:px-8 md:py-20">
      <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border bg-fd-border/60 md:grid-cols-3">
        {stats.map((s) => (
          <li
            key={s.kicker}
            className="flex flex-col gap-2 bg-fd-background p-7 md:p-9"
          >
            <span className="t-mono text-[10.5px] uppercase tracking-[0.18em] text-fd-muted-foreground">
              {s.kicker}
            </span>
            <span className="t-mono mt-1 text-[44px] font-medium leading-none tracking-tight text-fd-foreground">
              {s.big}
            </span>
            <span className="t-mono text-[12px] text-fd-muted-foreground">
              {s.unit}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ============================================================
   CRYPTOGRAPHY. full-width tile, Dithering swirl backdrop
   ============================================================ */
function CryptographyTile() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 md:px-8">
      <div className="relative overflow-hidden rounded-3xl border bg-fd-card/40 px-7 py-12 md:px-12 md:py-16">
        <div className="pointer-events-none absolute inset-0 opacity-[0.32]">
          <DitherBg
            colorBack="#000000"
            colorFront="#2dd4d2"
            shape="swirl"
            type="4x4"
            pxSize={3}
            speed={0.4}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--color-fd-card) 88%, transparent) 75%, var(--color-fd-card) 100%)",
          }}
        />

        <div className="relative z-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="t-mono text-[11px] uppercase tracking-[0.18em] text-fd-primary">
              The cryptography
            </span>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] md:text-5xl">
              2PC-MPC. The user is part of the math.
            </h2>
            <p className="mt-5 max-w-[58ch] text-fd-muted-foreground md:text-[17px]">
              Every signature needs both your user and the Ika network to
              cooperate. Neither side ever sees the full key. Compromise our
              servers and your users are still safe. Compromise the user, and
              the network alone cannot sign. The full key never gets
              reassembled.
            </p>

            <div className="mt-7 grid grid-cols-3 gap-3">
              {[
                { kicker: "Client", title: "User share", sub: "In your app" },
                {
                  kicker: "Cooperate",
                  title: "Signature",
                  sub: "Produced on demand",
                },
                {
                  kicker: "Network",
                  title: "Threshold share",
                  sub: "Held by Ika validators",
                },
              ].map((c) => (
                <div
                  key={c.kicker}
                  className="rounded-xl border bg-fd-background/80 p-3.5 backdrop-blur-md"
                >
                  <span className="t-mono text-[10px] uppercase tracking-[0.14em] text-fd-primary">
                    {c.kicker}
                  </span>
                  <div className="mt-1 text-[13.5px] font-medium text-fd-foreground">
                    {c.title}
                  </div>
                  <div className="t-mono mt-0.5 text-[10.5px] text-fd-muted-foreground">
                    {c.sub}
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/docs/guide/mpc"
              className="t-mono mt-7 inline-flex items-center gap-1.5 text-[12.5px] text-fd-primary hover:underline"
            >
              Read the protocol
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="lg:col-span-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["UC-secure", "Universal composability"],
                ["Identifiable abort", "Misbehavior is named"],
                ["Public verifiability", "Any third party can audit"],
                ["Constant-round", "User-side flow"],
              ].map(([title, sub]) => (
                <div
                  key={title}
                  className="rounded-xl border bg-fd-background/70 p-4 backdrop-blur-md"
                >
                  <div className="text-sm font-medium text-fd-foreground">
                    {title}
                  </div>
                  <div className="t-mono mt-1 text-[10.5px] uppercase tracking-[0.12em] text-fd-muted-foreground">
                    {sub}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SINGLE API + SUI ANCHOR. col 7 / col 5
   ============================================================ */
function SingleApiAndSui() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pt-5 md:px-8 md:pt-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
        {/* Single API. Halftone backdrop */}
        <div className="relative col-span-1 overflow-hidden rounded-3xl border bg-fd-card/40 p-7 md:col-span-7 md:p-10">
          <div className="pointer-events-none absolute -right-12 -top-12 h-72 w-72 opacity-[0.45]">
            <HalftoneBg
              colorBack="#000000"
              colorFront="#2dd4d2"
              size={3.5}
              type="gooey"
              speed={0.4}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="relative">
            <span className="t-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground">
              Single API
            </span>
            <h3 className="mt-3 max-w-[20ch] text-2xl font-semibold tracking-tight md:text-3xl">
              One call. Every chain that matters.
            </h3>
            <p className="mt-3 max-w-[44ch] text-fd-muted-foreground">
              Sign Bitcoin, Ethereum, Solana, Sui, and every chain in between
              with the same code. Pick a chain, pass a message, ship.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2 text-[12px]">
              {[
                ["SECP256K1", "BTC, ETH, all EVMs, Cosmos"],
                ["ED25519", "Solana, Sui, Aptos, NEAR"],
                ["SECP256R1", "WebAuthn, niche enterprise"],
                ["RISTRETTO", "Substrate, zk uses"],
              ].map(([c, label]) => (
                <div
                  key={c as string}
                  className="t-mono flex flex-col rounded-lg border bg-fd-background/80 px-3 py-2 backdrop-blur-md"
                >
                  <span className="font-medium text-fd-foreground">{c}</span>
                  <span className="text-[10.5px] text-fd-muted-foreground">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sui anchor. Dithering wave backdrop */}
        <div className="relative col-span-1 overflow-hidden rounded-3xl border bg-fd-card/40 p-7 md:col-span-5 md:p-10">
          <div className="pointer-events-none absolute inset-0 opacity-[0.4]">
            <DitherBg
              colorBack="#000000"
              colorFront="#0a8c8b"
              shape="wave"
              type="4x4"
              pxSize={3}
              speed={0.5}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--color-fd-card) 70%, transparent) 0%, var(--color-fd-card) 100%)",
            }}
          />
          <div className="relative flex h-full flex-col">
            <span className="t-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground">
              Anchored on
            </span>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              Every signature lives on Sui.
            </h3>
            <p className="mt-3 text-fd-muted-foreground">
              Every signature is recorded on Sui mainnet. Public, ordered,
              signed by validators. If we go offline, your wallets are still
              there.
            </p>
            <Link
              href="/docs/guide/dwallets"
              className="t-mono mt-auto inline-flex items-center gap-1.5 pt-6 text-[12.5px] text-fd-primary hover:underline"
            >
              How dWallets work
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PRICING + ENGINEERS. col 5 / col 7
   ============================================================ */
function PricingAndEngineers() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pt-5 pb-20 md:px-8 md:pt-6 md:pb-32">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
        {/* Pricing */}
        <div className="relative col-span-1 overflow-hidden rounded-3xl border bg-fd-card/40 p-7 md:col-span-5 md:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 60% at 0% 100%, color-mix(in oklab, #fbbf24 22%, transparent), transparent 60%), radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--color-fd-foreground) 12%, transparent) 1px, transparent 1.5px)",
              backgroundSize: "cover, 14px 14px",
            }}
          />
          <div className="relative flex h-full flex-col">
            <span className="t-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground">
              Pricing
            </span>
            <h3 className="mt-3 max-w-[22ch] text-2xl font-semibold tracking-tight md:text-3xl">
              Pay per signature.
              <br />
              Pennies, not negotiations.
            </h3>
            <p className="mt-3 text-fd-muted-foreground">
              Pay per op in microUSD. A signature is 10,000 µ$ ($0.01) at the
              default rate. Top up by depositing an accepted Sui-side coin and
              declaring the tx digest.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 t-mono text-[11.5px]">
              {[
                ["sign", "10,000 µ$"],
                ["dwallet.dkg", "50,000 µ$"],
                ["encryption-key", "1,000 µ$"],
              ].map(([k, v]) => (
                <span
                  key={k as string}
                  className="rounded-full border bg-fd-background/80 px-3 py-1.5 backdrop-blur-md"
                >
                  <span className="text-fd-muted-foreground">{k}</span>
                  <span className="ms-2 text-fd-foreground">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Engineers. code-shaped tile with grain accent */}
        <div className="relative col-span-1 overflow-hidden rounded-3xl border bg-fd-card/40 p-7 md:col-span-7 md:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 50% 60% at 100% 0%, color-mix(in oklab, var(--color-fd-primary) 22%, transparent), transparent 65%), radial-gradient(ellipse 40% 40% at 0% 100%, color-mix(in oklab, #a855f7 18%, transparent), transparent 65%), radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--color-fd-foreground) 10%, transparent) 1px, transparent 1.5px)",
              backgroundSize: "cover, cover, 14px 14px",
            }}
          />
          <div className="relative flex h-full flex-col gap-7 md:flex-row md:items-stretch">
            <div className="md:w-[40%]">
              <span className="t-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground">
                Built for engineers
              </span>
              <h3 className="mt-3 max-w-[18ch] text-2xl font-semibold tracking-tight md:text-3xl">
                Same calls, three languages.
              </h3>
              <p className="mt-3 text-fd-muted-foreground">
                Drop into TypeScript, React, or Rust. Same names, same shapes,
                same docs. Pick the one your team already ships in.
              </p>
              <div className="mt-6 flex flex-wrap gap-1.5 t-mono text-[11px]">
                {["TS", "TSX", "RS"].map((tag) => (
                  <span
                    key={tag}
                    className="grid h-6 min-w-7 place-items-center rounded-md border bg-fd-background/80 px-1.5 backdrop-blur-md"
                  >
                    {tag}
                  </span>
                ))}
                <span className="t-mono ms-1 self-center text-[11px] text-fd-muted-foreground">
                  npm · cargo
                </span>
              </div>
            </div>
            <div className="md:flex-1">
              <div className="rounded-xl border bg-fd-background/80 p-1.5 backdrop-blur-md">
                <pre className="t-mono px-4 py-3 text-[12px] leading-[1.7]">
                  <span className="text-fd-muted-foreground">
                    {"// any chain, any runtime"}
                  </span>
                  {"\n"}
                  <span className="text-pink-500 dark:text-pink-300">use</span>{" "}
                  mpckit::{"{MpcKit, Curve}"};{"\n\n"}
                  <span className="text-pink-500 dark:text-pink-300">let</span>{" "}
                  api = MpcKit::builder()
                  {"\n  "}
                  .api_key(key)
                  {"\n  "}
                  .network(Network::Mainnet)
                  {"\n  "}
                  .build()?;
                  {"\n\n"}
                  <span className="text-pink-500 dark:text-pink-300">let</span>{" "}
                  sig = api.sign(args).await?;
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   CLOSING CTA. primary tinted shader behind a centered card
   ============================================================ */
function ClosingCTA() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pb-24 md:px-8">
      <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl border bg-fd-card/40 p-10 text-center md:p-16">
        <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
          <GrainBg
            colors={["#0a8c8b", "#2dd4d2", "#0c1a1a"]}
            colorBack="#000000"
            softness={0.85}
            intensity={0.85}
            noise={0.45}
            shape="blob"
            speed={1.4}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--color-fd-card) 70%, transparent) 60%, var(--color-fd-card) 100%)",
          }}
        />
        <Mark size={48} className="relative text-fd-foreground" />
        <h2 className="relative max-w-[20ch] text-3xl font-semibold tracking-[-0.025em] md:text-5xl">
          Ship a signature this afternoon.
        </h2>
        <p className="relative max-w-[52ch] text-fd-muted-foreground">
          Grab a key, install the SDK, sign your first message. The docs walk
          you through every step.
        </p>
        <div className="relative mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={DASHBOARD_URL}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Open dashboard
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="/docs/guide/quickstart"
            className="inline-flex h-11 items-center gap-2 rounded-full border bg-fd-card/70 px-5 text-sm font-medium text-fd-foreground backdrop-blur-md transition-colors hover:bg-fd-accent"
          >
            Quickstart
          </Link>
          <Link
            href="/docs/typescript"
            className="inline-flex h-11 items-center gap-2 rounded-full px-1 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
          >
            SDK reference
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FOOTER. brand mark, three columns of links, signature line
   ============================================================ */
function SiteFooter() {
  const cols: { kicker: string; links: { label: string; href: string }[] }[] = [
    {
      kicker: "Product",
      links: [
        { label: "Quickstart", href: "/docs/guide/quickstart" },
        { label: "Authentication", href: "/docs/guide/authentication" },
        { label: "TypeScript SDK", href: "/docs/typescript" },
        { label: "React hooks", href: "/docs/react" },
        { label: "Rust crate", href: "/docs/rust" },
      ],
    },
    {
      kicker: "Concepts",
      links: [
        { label: "dWallets on Sui", href: "/docs/guide/dwallets" },
        { label: "How 2PC-MPC works", href: "/docs/guide/mpc" },
        { label: "Supported chains", href: "/docs/guide/chains" },
        {
          label: "The 2PC-MPC paper",
          href: "https://eprint.iacr.org/2024/253",
        },
      ],
    },
    {
      kicker: "Community",
      links: [
        { label: "Open dashboard", href: DASHBOARD_URL },
        { label: "GitHub", href: "https://github.com/dwallet-labs/ika" },
        { label: "X / Twitter", href: "https://x.com/ikadotxyz" },
        { label: "Quickstart", href: "/docs/guide/quickstart" },
      ],
    },
  ];

  return (
    <footer className="mt-auto border-t bg-fd-background">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-14 md:px-8 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-10">
          <div className="md:col-span-5">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-fd-foreground"
            >
              <Mark size={26} />
              <span className="text-[15px] font-semibold tracking-tight">
                MpcKit
              </span>
            </Link>
            <p className="mt-5 max-w-[42ch] text-sm text-fd-muted-foreground">
              The signing API for every chain that matters. Hosted MPC, settled
              on Sui, billed by the signature.
            </p>
            <p className="t-mono mt-6 inline-flex items-center gap-2 rounded-full border bg-fd-card/70 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.16em] text-fd-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              All systems go
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 md:col-span-7 md:grid-cols-3">
            {cols.map((col) => (
              <div key={col.kicker}>
                <span className="t-mono text-[10.5px] uppercase tracking-[0.18em] text-fd-muted-foreground">
                  {col.kicker}
                </span>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-[13.5px] text-fd-foreground/85 transition-colors hover:text-fd-primary"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col-reverse items-start gap-4 border-t pt-6 text-[12px] text-fd-muted-foreground md:flex-row md:items-center md:justify-between">
          <span className="t-mono">
            © 2026 MpcKit. Built on Sui, signed with care.
          </span>
          <span className="t-mono text-[10.5px] uppercase tracking-[0.18em]">
            Hosted MPC · settled on Sui mainnet
          </span>
        </div>
      </div>
    </footer>
  );
}
