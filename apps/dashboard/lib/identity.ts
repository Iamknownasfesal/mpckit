/**
 * Turn a Better-Auth user record into display strings. SIWS users have
 * a synthetic email (`0x...@sui.<host>`) we never want to show; their
 * primary identity is the Sui address.
 */

export type Identity = {
  kind: "siws" | "user";
  primary: string;
  secondary: string;
  initials: string;
};

export function identityDisplay(user: {
  name?: string | null;
  email?: string | null;
}): Identity {
  const name = user.name ?? "";
  const email = user.email ?? "";
  const siwsMatch = email.match(/^(0x[0-9a-fA-F]+)@sui\./);
  if (siwsMatch?.[1]) {
    return {
      kind: "siws",
      primary: shortSuiAddress(siwsMatch[1]),
      secondary: "Sui wallet",
      initials: "",
    };
  }
  return {
    kind: "user",
    primary: name || email.split("@")[0] || "Signed in",
    secondary: shortEmail(email),
    initials: (name || email || "?")
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join(""),
  };
}

export function shortSuiAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortEmail(email: string): string {
  if (email.length <= 28) return email;
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 10)}…@${domain}`;
}
