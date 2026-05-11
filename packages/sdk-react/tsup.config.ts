import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  tsconfig: "./tsconfig.build.json",
  // @mpckit/sdk re-exports the App type via the eden subexport. If a
  // sdk-react file ever imports from "@mpckit/sdk/eden", `resolve: true`
  // would chase that through. Today none do — but leaving it on is
  // cheap and future-proofs the build.
  dts: { resolve: true },
  clean: true,
  sourcemap: true,
  target: "es2022",
  // JSX is "react-jsx" in tsconfig; tsup picks that up from tsconfig.
  external: [
    "react",
    "react-dom",
    "@tanstack/react-query",
    "@mpckit/sdk",
    "@mpckit/core",
    "@mysten/sui",
  ],
});
