# Design: SAU-205 — Project scaffolding & CLI entry point

## Context
This is the greenfield foundation ticket for Misty, a Shopify store management CLI. It sets up the Bun project, CLI entry point at `bin/misty.ts`, argument routing for `misty <resource> <verb>`, global flag parsing, and help/version output. No commands are implemented — just the dispatch skeleton they'll plug into. Spec references: "Command Structure", "Global Flags", "Environment" sections of `SPEC.md`.

## Approach

Initialize a Bun project and build a zero-dependency CLI argument parser + router.

**Project setup:** `bun init`, configure `package.json` with `"bin": { "misty": "bin/misty.ts" }`, add `tsconfig.json`.

**Architecture:** Three layers, each a single file:

1. **`bin/misty.ts`** — Entry point. Reads `Bun.argv`, calls the parser, calls the router. Catches top-level errors. ~20 lines.

2. **`src/args.ts`** — Pure function `parseArgs(argv: string[])` that returns a typed result: `{ resource?, verb?, positionals, flags: { json, noColor, store?, help, version } }`. Uses Bun's built-in `util.parseArgs` (Node-compatible). No I/O.

3. **`src/router.ts`** — A registry of resources and their verbs. For now, the registry is empty. The router function takes parsed args and either: prints help, prints version, dispatches to a command handler, or writes an error to stderr and exits 2. Command handlers have a common signature: `(args: ParsedArgs) => Promise<void>`.

**Help output:** Hard-coded strings. Top-level help lists the `<resource> <verb>` pattern and global flags. Resource-level help lists available verbs (populated from the registry). No template engine needed.

**Version:** Read from `package.json` at runtime via `import pkg from "../package.json"`.

**NO_COLOR:** Check `process.env.NO_COLOR` (any non-empty value) OR `--no-color` flag. Store result in flags as `noColor: boolean`.

**Registration pattern for future commands:**
```
// In router.ts
const commands: Record<string, Record<string, CommandHandler>> = {};
export function register(resource: string, verb: string, handler: CommandHandler) { ... }
```
Future tickets just call `register("product", "list", productList)` and import into the entry point.

## Key decisions

1. **Use `util.parseArgs` (Bun built-in) instead of writing a custom parser.**
   - Alternatives: hand-rolled parser, adopt `commander`/`yargs`.
   - Why: `util.parseArgs` ships with Bun, handles `--flag value`, `--flag=value`, short flags, boolean flags, and `strict` mode. Satisfies the AC with zero dependencies. Hand-rolling would duplicate this. External libs are explicitly out of scope per AC.

2. **Flat file structure (`src/args.ts`, `src/router.ts`) rather than a `src/cli/` directory tree.**
   - Alternatives: `src/cli/parser.ts`, `src/cli/router.ts`, `src/cli/help.ts`.
   - Why: There are only 2-3 files. Nesting adds navigation cost for no benefit. When resource commands arrive, they'll live in `src/commands/<resource>.ts` — that's the directory worth creating later.

3. **Command registry as a plain object, not a class or plugin system.**
   - Alternatives: class-based `Command` pattern, dynamic `import()` discovery.
   - Why: A `Record<string, Record<string, CommandHandler>>` is the simplest structure that supports the `<resource> <verb>` dispatch. Dynamic imports add complexity with no current benefit (there are no commands yet). Revisit if command count exceeds ~20.

4. **`--version` / `-v` short flag conflicts with potential future verb flags — keep `-v` for version at the global level only.**
   - The spec shows `-v` for `--version`. This is fine because global flags are parsed before dispatch; subcommand flags are a separate parse pass (future tickets).

5. **Exit codes: 0 for success (help, version), 2 for usage errors (unknown resource/verb, bad flags).**
   - Matches spec: "Exit code 0 on success, 1 on runtime/API error, 2 on usage error."

## Library / framework evaluation

Nothing worth evaluating. The AC explicitly require "no external dependencies beyond Bun built-ins." Bun provides `util.parseArgs` for flag parsing and built-in test runner (`bun test`) for testing. This is a CLI skeleton — no HTTP, no formatting, no complexity that would benefit from a library.

## Files touched

- `package.json` — **new** — name, version, bin entry, scripts (test, lint)
- `tsconfig.json` — **new** — Bun-compatible TS config
- `bin/misty.ts` — **new** — CLI entry point, shebang `#!/usr/bin/env bun`
- `src/args.ts` — **new** — Argument parsing (pure function)
- `src/router.ts` — **new** — Command registry and dispatch
- `src/types.ts` — **new** — Shared types (`ParsedArgs`, `CommandHandler`, `GlobalFlags`)
- `tests/args.test.ts` — **new** — Unit tests for `parseArgs`
- `tests/router.test.ts` — **new** — Unit tests for dispatch logic (unknown resource/verb → error)
- `tests/cli.test.ts` — **new** — Integration tests spawning `bun bin/misty.ts` and asserting stdout/stderr/exit codes
- `.gitignore` — **new** — node_modules, .env
- `README.md` — **new** — Minimal setup instructions (bun install, bun link, env vars)

## Refactor opportunities

None spotted. Greenfield project — nothing to refactor.

## Risks / open questions

1. **`util.parseArgs` strict mode and unknown flags.** When `strict: true`, `util.parseArgs` throws on unknown flags. Since global flags are parsed before dispatch, subcommand-specific flags (e.g., `--status` on `product list`) will be unknown at the global parse level. **Solution:** parse global flags with `strict: false`, extract known globals, pass remaining tokens to the command handler for its own parsing. This needs to be designed in now so future command tickets don't have to refactor the parser.

2. **`bun link` behavior.** The AC says `bun link` installs `misty` globally. This requires `"bin"` in `package.json` pointing to the entry point with a proper shebang. Straightforward but needs integration test verification.

3. **No sibling tickets found in Linear.** Either SAU-205 is the only Misty ticket created so far, or the others are in a different project/milestone. No blocking dependencies identified.

## Out of scope

Per the ticket:
- Output formatting layer (table rendering, JSON envelope) — separate ticket
- GraphQL client and authentication — separate ticket
- Individual resource command implementations — later tickets

Additionally discovered:
- **`src/commands/` directory structure** — not needed until the first command is implemented. Don't create empty directories.
- **`.env` loading** — the spec mentions `.env` for config, but this ticket has no commands that need auth. Defer to the authentication ticket.
- **Error formatting** — stderr output in this ticket is plain text. Colored/structured errors belong in the formatting ticket.
