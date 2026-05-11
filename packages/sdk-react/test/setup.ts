/**
 * Bun test preload: register happy-dom globals so React + testing-
 * library can render. Wired via `bunfig.toml`'s `preload` field.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
