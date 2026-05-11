import { type NextRequest, NextResponse } from "next/server";

const DOCS_HOSTS = new Set(["docs.mpckit.xyz", "docs.localhost:3010"]);

const APEX_HOSTS = new Set(["mpckit.xyz", "www.mpckit.xyz"]);

// SEO + asset routes Next generates at the apex root. They must serve
// as-is on every host; never rewrite them under /docs.
const SPECIAL_PATHS = new Set([
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/twitter-image",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/manifest.webmanifest",
]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  // Skip Next-generated metadata routes (account for hash suffixes
  // like /icon-abc123) and any path with a file extension.
  if (
    SPECIAL_PATHS.has(pathname) ||
    /^\/(icon|apple-icon|opengraph-image|twitter-image)(-[^/]+)?\/?$/.test(
      pathname,
    ) ||
    /\.[a-z0-9]+$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (DOCS_HOSTS.has(host)) {
    if (!pathname.startsWith("/docs")) {
      url.pathname = pathname === "/" ? "/docs" : `/docs${pathname}`;
      return NextResponse.rewrite(url);
    }
  } else if (APEX_HOSTS.has(host) && pathname.startsWith("/docs")) {
    const docsUrl = new URL(req.url);
    docsUrl.protocol = "https:";
    docsUrl.hostname = "docs.mpckit.xyz";
    docsUrl.port = "";
    const stripped = pathname.replace(/^\/docs/, "");
    docsUrl.pathname = stripped === "" ? "/" : stripped;
    return NextResponse.redirect(docsUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image).*)"],
};
