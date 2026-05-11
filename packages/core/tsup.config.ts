import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  tsconfig: "./tsconfig.build.json",
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // @mysten/sui is the consumer's responsibility — it's a peerDep at
  // the SDK boundary, not a dependency to inline.
  external: ["@mysten/sui"],
});
