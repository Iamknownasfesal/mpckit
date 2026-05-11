# syntax=docker/dockerfile:1.7
# Backend image. Bun runs TypeScript directly, no build step needed —
# we install workspace deps in one stage, then copy sources + installed
# node_modules into a minimal runtime image.
#
# Workspace shape: apps/backend depends on @mpckit/core (packages/core)
# and @mpckit/sdk (packages/sdk-ts). Both export src/ directly, so we
# ship their source too.

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

# ---- runtime stage ----------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
# image.source links the package to its origin repo on ghcr.io so the
# repo's workflow token gets write access on subsequent pushes.
LABEL org.opencontainers.image.source="https://github.com/iamknownasfesal/mpckit"
LABEL org.opencontainers.image.description="MpcKit backend (Bun + Elysia + pg-boss)"
LABEL org.opencontainers.image.licenses="BSD-3-Clause"
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# curl is used by the healthcheck.
RUN apk add --no-cache curl

# Bring in the entire deps result (root + per-workspace node_modules).
# Then overlay sources for the packages the backend touches. Bun's
# isolated installer stores per-workspace deps under each workspace's
# own node_modules, so copying only the root /app/node_modules would
# leave apps/backend and packages/* unable to resolve imports.
COPY --from=deps /app /app
COPY apps/backend ./apps/backend
COPY packages/core ./packages/core
COPY packages/sdk-ts ./packages/sdk-ts

# Drop privileges. The `bun` user is shipped by the base image.
USER bun

WORKDIR /app/apps/backend
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/v1/health || exit 1

# Migrations run from inside api.ts/worker.ts on startup.
CMD ["bun", "run", "src/index.ts"]
