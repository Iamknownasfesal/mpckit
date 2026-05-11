# sui-gas-pool (the daemon binary is `sui-gas-station`).
#
# Mysten doesn't publish an image, so we build from source. The first
# build is slow (the Sui crate graph is large); subsequent builds reuse
# the BuildKit cache mounts for `~/.cargo/registry` and the cargo target
# directory, so iteration after that is quick.
#
# Build:   docker compose build gas-station
# Run:     docker compose up gas-station
# Inspect: curl http://localhost:9527/

ARG GAS_POOL_REF=main

# ── builder ────────────────────────────────────────────────────────────
FROM rust:1.92-bookworm AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        cmake clang libpq-dev pkg-config protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

ARG GAS_POOL_REF
RUN git clone --depth 1 --branch ${GAS_POOL_REF} \
        https://github.com/MystenLabs/sui-gas-pool.git /src

WORKDIR /src

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --bin sui-gas-station && \
    cp /src/target/release/sui-gas-station /usr/local/bin/sui-gas-station

# ── runtime ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/sui-gas-station /usr/local/bin/sui-gas-station
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9527 9184
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s \
    CMD curl -fsS http://127.0.0.1:9527/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
