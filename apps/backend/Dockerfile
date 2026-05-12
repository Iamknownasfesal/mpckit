# syntax=docker/dockerfile:1.7
# Backend image. Three stages:
#   deps  - install workspace deps from manifests + lockfile
#   build - build @mpckit/core and @mpckit/sdk so packages/*/dist exists
#           (their package.json points main/exports at dist/, so the
#           backend's workspace imports fail without this step)
#   runtime - minimal image with the resolved tree + backend source

ARG BUN_VERSION=1.3.10

# ---- deps stage --------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# Copy only the manifests + lockfile so this layer caches as long as
# dependencies are unchanged. Every workspace declared in the root
# package.json must be present or `bun install --frozen-lockfile`
# rejects the lockfile as out-of-sync, even if the backend itself
# doesn't depend on those workspaces transitively.
COPY package.json bun.lock turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/docs/package.json apps/docs/
COPY packages/core/package.json packages/core/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY examples/ts-node/package.json examples/ts-node/
COPY examples/ts-browser/package.json examples/ts-browser/

RUN bun install --frozen-lockfile --ignore-scripts

# ---- build stage ------------------------------------------------------
# @mpckit/core and @mpckit/sdk are workspace deps whose package.json
# points "main"/"exports" at ./dist/index.js (so npm consumers get the
# built tarball). The backend imports them via workspace resolution, so
# dist/ must exist before runtime or Bun's resolver throws MODULE_NOT_FOUND.
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app /app
COPY packages/core ./packages/core
COPY packages/sdk-ts ./packages/sdk-ts
# tsup inlines the backend App type into dist/eden.d.ts via a relative
# import (packages/sdk-ts/src/eden.ts), so apps/backend source needs to
# be present at build time even though we're not building backend itself.
COPY apps/backend ./apps/backend
RUN bun run build --filter='@mpckit/core' --filter='@mpckit/sdk'

# ---- runtime stage ----------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
# image.source links the package to its origin repo on ghcr.io so the
# repo's workflow token gets write access on subsequent pushes.
LABEL org.opencontainers.image.source="https://github.com/iamknownasfesal/mpckit"
LABEL org.opencontainers.image.description="MPCKit backend (Bun + Elysia + pg-boss)"
LABEL org.opencontainers.image.licenses="BSD-3-Clause"
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# curl is used by the healthcheck.
RUN apk add --no-cache curl

# Pull the fully-resolved tree from the build stage: node_modules,
# built packages/*/dist, and apps/backend source.
COPY --from=build /app /app

# Drop privileges. The `bun` user is shipped by the base image.
USER bun

WORKDIR /app/apps/backend
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/v1/health || exit 1

# Migrations run from inside api.ts/worker.ts on startup.
CMD ["bun", "run", "src/index.ts"]
