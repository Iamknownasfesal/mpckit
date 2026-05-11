# syntax=docker/dockerfile:1.7
# Dashboard image. Next.js 15 standalone output: build with bun (the
# workspace's package manager), run the standalone Node server.
#
# Build context is the repo root, since the dashboard depends on the
# @mpckit/react and @mpckit/sdk workspace packages.

ARG BUN_VERSION=1.3.10
ARG NODE_VERSION=20-alpine

# ---- deps stage --------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# Every workspace declared in the root package.json must be present
# or `bun install --frozen-lockfile` rejects the lockfile as
# out-of-sync, even when the dashboard doesn't depend on those
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

RUN bun install --frozen-lockfile --ignore-scripts

# ---- build stage ------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# Bun's isolated installer puts dependencies under each workspace's
# node_modules (e.g. apps/dashboard/node_modules), so copy the entire
# /app from deps to preserve every per-workspace node_modules. Then
# overlay sources on top — COPY is additive and doesn't delete the
# node_modules dirs already present.
COPY --from=deps /app /app
COPY apps/dashboard ./apps/dashboard
COPY packages/core ./packages/core
COPY packages/sdk-ts ./packages/sdk-ts
COPY packages/sdk-react ./packages/sdk-react

# `next build` only needs NEXT_PUBLIC_* at build time; runtime envs are
# read fresh in the standalone server.
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}

RUN cd apps/dashboard && bun run build

# ---- runtime stage ----------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
LABEL org.opencontainers.image.source="https://github.com/iamknownasfesal/mpckit"
LABEL org.opencontainers.image.description="MpcKit dashboard (Next.js 15)"
LABEL org.opencontainers.image.licenses="BSD-3-Clause"
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3011 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl && \
    addgroup -S app && adduser -S app -G app

# Standalone server + assets. outputFileTracingRoot=../../ in
# next.config.mjs keeps the workspace layout intact inside standalone.
COPY --from=build --chown=app:app /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=app:app /app/apps/dashboard/public ./apps/dashboard/public

USER app
EXPOSE 3011

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "apps/dashboard/server.js"]
