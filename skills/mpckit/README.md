# MPCKit skill

A Claude Code skill (also compatible with every agent supported by [skills.sh](https://skills.sh)) that teaches your agent how to build against the MPCKit SDKs across three languages:

- `@mpckit/sdk`: TypeScript (Node, Bun, Deno, browsers)
- `@mpckit/react`: React + TanStack Query
- `mpckit`: Rust crate (HTTP-only by default, full ceremonies behind `features = ["crypto"]`)

## Install

```bash
npx skills add Iamknownasfesal/mpckit --skill mpckit
```

Or directly:

```bash
npx skills add https://github.com/Iamknownasfesal/mpckit/tree/main/skills/mpckit
```

Install per-agent (defaults to all agents present in the project):

```bash
npx skills add Iamknownasfesal/mpckit --skill mpckit -a claude-code -a cursor
```

Install globally (user directory) instead of per-project:

```bash
npx skills add Iamknownasfesal/mpckit --skill mpckit -g
```

## Layout

```
skills/mpckit/
  SKILL.md             # main entry; loaded into the agent context
  README.md            # this file
  metadata.json        # version, author, license
  references/
    typescript.md      # @mpckit/sdk full surface
    react.md           # @mpckit/react Provider + hooks
    rust.md            # mpckit crate, default + crypto feature
    flows.md           # cross-language onboard + sign recipes
    errors.md          # error taxonomy, retry policy, codes
```

`SKILL.md` is the hub; the `references/` files are loaded on demand by the agent only when a task touches them. That keeps the conversation context small for simple questions and full coverage available for deep work.

## When the agent should use this skill

The frontmatter's `description` field lists triggers; in short: any task involving the MPCKit SDKs, the `MPCKit` class, `useMPCKit`, the Rust `MPCKit::builder()`, dWallet onboarding / signing, or the `api.mpckit.xyz` / `api.testnet.mpckit.xyz` endpoints.

## Maintaining the skill

Update this skill in lockstep with SDK changes. The SDK surface lives at:

- `packages/sdk-ts/src/index.ts` and `packages/sdk-ts/src/api.ts`
- `packages/sdk-react/src/index.ts` and `packages/sdk-react/src/provider.tsx`
- `packages/sdk-rust/src/lib.rs` and `packages/sdk-rust/src/client.rs`

If you touch a public export in any of those, also update `SKILL.md` or the matching `references/*.md`. Bump `metadata.json:version` to match the SDK minor.

## Companion docs

The repo's published docs include a page about this skill at `/docs/skills` (source: `apps/docs/content/docs/skills.mdx`). That page is for humans browsing the docs site; this skill is for the agents you give your codebase to.
