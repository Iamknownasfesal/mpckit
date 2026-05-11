const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ??
  "http://localhost:3000";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Emit a self-contained server under .next/standalone for container
  // builds. The Dockerfile copies just that + .next/static + public.
  output: "standalone",
  // Workspace packages live above apps/dashboard; standalone needs to
  // know to pull them in.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  /**
   * Proxy backend routes through the same origin so the browser never
   * sees a cross-origin request. Avoids CORS + same-site cookie issues
   * in local dev and on Vercel (when /api/auth/* and /v1/* are served
   * by the dashboard domain).
   */
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      { source: "/v1/:path*", destination: `${backendUrl}/v1/:path*` },
    ];
  },
};

export default config;
