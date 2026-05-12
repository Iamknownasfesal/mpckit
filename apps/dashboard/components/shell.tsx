"use client";

import {
  ArrowUpRight,
  BookOpen,
  Braces,
  CreditCard,
  Github,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut, useSession } from "@/lib/auth-client";
import { identityDisplay } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  NetworkBadge,
  NetworkBodyTint,
  NetworkHeaderPill,
  NetworkSwitcherBootstrap,
} from "./dash/network-switcher";
import { Mark } from "./mark";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/api-keys", label: "API keys", icon: KeyRound },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/dwallets", label: "dWallets", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = session?.user;

  useEffect(() => {
    if (!isPending && !user) router.replace("/sign-in");
  }, [isPending, user, router]);

  if (isPending || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen bg-background">
      <NetworkBodyTint />
      <NetworkSwitcherBootstrap />
      <BackgroundField />
      <SidebarRail pathname={pathname} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-background/70 px-4 backdrop-blur-xl md:px-10">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="size-4" />
                  <span className="sr-only">Open nav</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-r p-0">
                <MobileNav
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <Breadcrumb pathname={pathname} />
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex">
              <NetworkHeaderPill />
            </div>
            <UserMenu
              email={user.email ?? ""}
              name={user.name ?? ""}
              onSignOut={async () => {
                await signOut();
                router.replace("/sign-in");
              }}
            />
          </div>
        </header>

        <main className="relative flex-1 px-4 py-10 md:px-10 md:py-14">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function BackgroundField() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 dot-ledger"
        style={{
          maskImage:
            "radial-gradient(ellipse 80% 60% at 30% 0%, rgba(0,0,0,0.35) 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 30% 0%, rgba(0,0,0,0.35) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 15% 0%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 70%)",
        }}
      />
    </>
  );
}

function SidebarRail({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <Link
        href="/overview"
        className="group flex h-16 shrink-0 items-center gap-2.5 border-b px-5 transition-colors hover:bg-card/40"
      >
        <Mark
          size={24}
          className="text-foreground transition-transform group-hover:scale-105"
        />
        <span className="text-[15px] font-semibold tracking-tight">MPCKit</span>
        <span className="ml-auto inline-flex items-center rounded-full border bg-card/60 px-2 py-0.5 t-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          v1
        </span>
      </Link>

      <div className="px-3 pb-2 pt-4">
        <NetworkBadge />
      </div>

      <nav className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
        <div className="mx-3 my-5 border-t" />
        <ul className="space-y-0.5">
          <ExternalNav
            href="https://docs.mpckit.xyz"
            label="Documentation"
            icon={BookOpen}
          />
          <ExternalNav
            href="https://docs.mpckit.xyz/api"
            label="API reference"
            icon={Braces}
          />
          <ExternalNav
            href="https://github.com/dwallet-labs"
            label="GitHub"
            icon={Github}
          />
        </ul>
      </nav>

      <div className="border-t p-4">
        <div className="flex items-center justify-between t-mono text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-signal-live pulse-dot" />
            All systems go
          </span>
          <a
            href="https://status.mpckit.xyz"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Status
          </a>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href="/overview"
        onClick={onNavigate}
        className="flex h-16 shrink-0 items-center gap-2.5 border-b px-5"
      >
        <Mark size={24} />
        <span className="text-[15px] font-semibold tracking-tight">MPCKit</span>
      </Link>
      <div className="px-3 pt-4">
        <NetworkBadge />
      </div>
      <nav className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onClick={onNavigate}
            />
          ))}
        </ul>
      </nav>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: (typeof NAV)[number];
  pathname: string;
  onClick?: () => void;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <li className="relative">
      <Link
        href={item.href}
        onClick={onClick}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
          active
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
        )}
      >
        {active ? (
          <span
            aria-hidden
            className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r-full bg-primary"
          />
        ) : null}
        <Icon className={cn("size-4", active ? "text-primary" : "")} />
        <span className={active ? "font-medium" : ""}>{item.label}</span>
      </Link>
    </li>
  );
}

function ExternalNav({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-card/50 hover:text-foreground"
      >
        <Icon className="size-4" />
        <span>{label}</span>
        <ArrowUpRight className="ml-auto size-3.5 opacity-50 transition-opacity group-hover:opacity-100" />
      </a>
    </li>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const section = NAV.find(
    (n) => pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
  return (
    <div className="flex items-center gap-2">
      <span className="t-kicker">Console</span>
      <span className="text-muted-foreground/40">/</span>
      <span className="t-mono text-[12px] font-medium text-foreground">
        {section?.label ?? ""}
      </span>
    </div>
  );
}

function UserMenu({
  email,
  name,
  onSignOut,
}: {
  email: string;
  name: string;
  onSignOut: () => void;
}) {
  const ident = identityDisplay({ name, email });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-full border bg-card/70 px-1 py-1 pr-3 backdrop-blur-md transition-colors hover:border-primary/40"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
              {ident.kind === "siws" ? (
                <Wallet className="size-3.5" />
              ) : (
                ident.initials || "?"
              )}
            </AvatarFallback>
          </Avatar>
          <span className="t-mono hidden text-[11px] text-muted-foreground sm:inline">
            {ident.primary}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span
            className={ident.kind === "siws" ? "t-mono text-sm" : "text-sm"}
          >
            {ident.primary}
          </span>
          <span className="t-mono text-[11px] font-normal text-muted-foreground">
            {ident.secondary}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="https://docs.mpckit.xyz" target="_blank" rel="noreferrer">
            <ArrowUpRight className="size-4" /> Documentation
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            onSignOut();
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
