# syntax=docker/dockerfile:1.7
# Docs site. Next.js 15 + Fumadocs MDX, standalone output, node runtime.
#
# Build context is the repo root.

ARG BUN_VERSION=1.3.10
ARG NODE_VERSION=20-alpine

# ---- deps stage --------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# Every workspace declared in the root package.json must be present
# or `bun install --frozen-lockfile` rejects the lockfile as
# out-of-sync, even when the docs site doesn't depend on those
# workspaces transitively.
COPY package.json bun.lock turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/core/package.json packages/core/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY examples/ts-node/package.json examples/ts-node/
COPY examples/ts-browser/package.json examples/ts-browser/

# Postinstall scripts (fumadocs-mdx, etc.) need sources to exist, so
# defer them until the build stage.
RUN bun install --frozen-lockfile --ignore-scripts

# ---- build stage ------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# Bring in the deps result (root + per-workspace node_modules), then
# overlay sources. fumadocs-mdx postinstall needs the docs sources to
# exist, so we run it after the overlay.
COPY --from=deps /app /app
COPY apps/docs ./apps/docs

RUN cd apps/docs && bun run postinstall && bun run build

# ---- runtime stage ----------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
LABEL org.opencontainers.image.source="https://github.com/iamknownasfesal/mpckit"
LABEL org.opencontainers.image.description="MpcKit docs (Next.js 15 + Fumadocs)"
LABEL org.opencontainers.image.licenses="BSD-3-Clause"
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3010 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl && \
    addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/apps/docs/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=build --chown=app:app /app/apps/docs/public ./apps/docs/public

USER app
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "apps/docs/server.js"]
