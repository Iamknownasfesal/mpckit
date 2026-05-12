# @mpckit/core

Shared types and BCS schemas used by the [MPCKit](https://mpckit.xyz)
TypeScript SDK. Most consumers don't depend on this directly:
[`@mpckit/sdk`](https://www.npmjs.com/package/@mpckit/sdk) and
[`@mpckit/react`](https://www.npmjs.com/package/@mpckit/react) re-export
everything you need.

Pull this in directly if you're:

- building a custom HTTP client and need the wire types
- decoding raw BCS payloads from MPCKit responses outside the SDK
- writing tests that fixture against the typed contract

## Install

```sh
npm install @mpckit/core
```

## What's inside

- `PricingInfo` BCS schema (decodes the coordinator's
  `current_pricing()` return value)
- Wire-level types shared between backend and SDK

## License

BSD-3-Clause. Source:
[github.com/Iamknownasfesal/mpckit](https://github.com/Iamknownasfesal/mpckit).
