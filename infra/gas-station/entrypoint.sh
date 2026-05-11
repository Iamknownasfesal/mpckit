#!/usr/bin/env bash
# Materialise the gas-pool config at container start so the sponsor
# keypair never lives on disk in the image. Operator supplies it via
# `SUI_GAS_STATION_SPONSOR_KEYPAIR_B64` (base64 SuiKeyPair: flag||privkey).
set -euo pipefail

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[gas-station] missing required env $name" >&2
    exit 1
  fi
}

require SUI_GAS_STATION_SPONSOR_KEYPAIR_B64
require GAS_STATION_AUTH

REDIS_URL="${SUI_GAS_STATION_REDIS_URL:-redis://redis:6379}"
FULLNODE_URL="${SUI_GAS_STATION_FULLNODE_URL:-https://fullnode.testnet.sui.io:443}"
RPC_PORT="${SUI_GAS_STATION_RPC_PORT:-9527}"
METRICS_PORT="${SUI_GAS_STATION_METRICS_PORT:-9184}"
TARGET_BALANCE="${SUI_GAS_STATION_TARGET_BALANCE_MIST:-500000000}"
DAILY_USAGE_CAP="${SUI_GAS_STATION_DAILY_USAGE_CAP_MIST:-1500000000000}"
MAX_SUI_PER_REQUEST="${SUI_GAS_STATION_MAX_SUI_PER_REQUEST_MIST:-2000000000}"

cat >/tmp/gas-station.yaml <<EOF
---
signer-config:
  local:
    keypair: "${SUI_GAS_STATION_SPONSOR_KEYPAIR_B64}"
rpc-host-ip: 0.0.0.0
rpc-port: ${RPC_PORT}
metrics-port: ${METRICS_PORT}
gas-pool-config:
  redis:
    redis_url: "${REDIS_URL}"
fullnode-url: "${FULLNODE_URL}"
coin-init-config:
  target-init-balance: ${TARGET_BALANCE}
  refresh-interval-sec: 86400
daily-gas-usage-cap: ${DAILY_USAGE_CAP}
max-sui-per-request: ${MAX_SUI_PER_REQUEST}
advanced-faucet-mode: false
EOF

exec sui-gas-station --config-path /tmp/gas-station.yaml
