import { defineConfig } from "tsup";

export default defineConfig({
  // Three entrypoints become three top-level subexports:
  //   "@mpckit/sdk"             -> dist/index.{js,d.ts}
  //   "@mpckit/sdk/eden"        -> dist/eden.{js,d.ts}
  //   "@mpckit/sdk/worker-impl" -> dist/crypto/worker-impl.{js,d.ts}
  entry: ["src/index.ts", "src/eden.ts", "src/crypto/worker-impl.ts"],
  format: ["esm"],
  tsconfig: "./tsconfig.build.json",
  // Bundle declaration files so the backend `App` type that `eden.ts`
  // relies on (via a relative type-only import) is inlined into
  // dist/eden.d.ts. Without this, the published .d.ts would reference
  // ../../../apps/backend/src/... which doesn't exist on a consumer's
  // disk.
  dts: { resolve: true },
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  // Peer-style deps the consumer brings their own copy of. Mark them
  // external so tsup doesn't try to bundle them.
  external: ["@elysiajs/eden", "@ika.xyz/sdk", "@mysten/sui", "@mpckit/core"],
});
