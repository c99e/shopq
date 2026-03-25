# Design: SAU-205 — Project scaffolding & CLI entry point

## Context
This is the first ticket for the Misty CLI — a Shopify store management tool designed for AI agents. Nothing exists yet (no `package.json`, no source files). This ticket creates the Bun project, the CLI entry point at `bin/misty.ts`, and the `<resource> <verb>` dispatch skeleton that all future commands plug into. Spec references: "Command Structure", "Global Flags", "Environment" sections of `SPEC.md`.

## Approach

Create a minimal Bun project with hand-rolled argument parsing (no deps required). The architecture is:

1. **`bin/misty.ts`** — entry point. Reads `process.argv`, calls the parser, dispatches.
2. **`src/cli/parse.ts`** — pure function that takes `string[]` args and returns a structured result: `{ resource?, verb?, args[], flags: GlobalFlags }` or an error. Global flags are extracted here.
3. **`src/cli/help.ts`** — generates help text for top-level, resource-level, and command-level usage. Resources are registered in a simple registry.
4. **`src/cli/registry.ts`** — a `Map<string, Resource>` where `Resource = { name, description, verbs: Map<string, Command> }`. Empty for now — future tickets register commands. The registry drives help text and validation.
5. **`src/cli/types.ts`** — shared types: `GlobalFlags`, `ParsedArgs`, `Command`, `Resource`.

Flow: `bin/misty.ts` → parse args → check `--version`/`--help` → look up resource in registry → look up verb → if not found, stderr error + exit 2 → if found, call handler (no-op stubs for now).

The registry pattern means future tickets just add entries — no changes to dispatch logic.

## Key decisions

1. **Hand-rolled arg parsing vs. a library** — Hand-roll it. The flag set is small and fixed (5 global flags). Bun has no built-in arg parser worth using (`util.parseArgs` is Node-compat and clunky). A library would violate the "no external dependencies" AC. The parsing function is <80 lines and fully testable as a pure function.

2. **Registry as a plain Map vs. decorators/auto-discovery** — Plain Map with explicit registration. Future command files will call `registry.register("product", { ... })`. Simple, grep-able, no magic. Auto-discovery adds complexity for zero benefit at this scale.

3. **`bin/misty.ts` as a thin shell** — The entry point should do almost nothing: import parse, import dispatch, call them, handle exit codes. All logic lives in `src/` for testability. The `bin/` file has the shebang and is the `"bin"` entry in `package.json`.

4. **Exit code convention** — 0 for success/help/version, 1 for runtime errors (future), 2 for usage errors (bad resource/verb). Matches POSIX convention and the AC.

5. **`NO_COLOR` handling** — Check `process.env.NO_COLOR` (any non-empty value) OR `--no-color` flag. Store as `noColor: boolean` in `GlobalFlags`. Per no-color.org spec, presence of the var (even empty string) disables color — but the common convention is "set and non-empty". We'll follow the strict spec: if `NO_COLOR` env var exists (regardless of value), color is off.

6. **Project structure** — Flat `src/cli/` for now. No `src/commands/` yet (out of scope). Test files colocated as `*.test.ts` alongside source.

## Library / framework evaluation

Nothing worth evaluating. The AC explicitly requires no external dependencies. Bun built-ins provide:
- `Bun.argv` / `process.argv` for arg access
- `bun test` for testing
- `bun link` for global install
- `process.stdout.write` / `process.stderr.write` for output

CLI frameworks like Commander, yargs, or Clipanion would be overkill and violate the constraint. If the flag surface grows significantly in later tickets, `util.parseArgs` (built into Bun's Node compat) could be reconsidered, but it's not needed now.

## Files touched

- `package.json` — **new** — name, version, bin entry pointing to `bin/misty.ts`, scripts (test, lint)
- `tsconfig.json` — **new** — Bun-appropriate TS config
- `bin/misty.ts` — **new** — shebang + entry point, thin shell
- `src/cli/types.ts` — **new** — `GlobalFlags`, `ParsedArgs`, `Resource`, `Command` types
- `src/cli/parse.ts` — **new** — arg parsing pure function
- `src/cli/registry.ts` — **new** — resource/verb registry
- `src/cli/help.ts` — **new** — help text generation
- `src/cli/dispatch.ts` — **new** — main dispatch logic (parse → validate → route)
- `src/cli/parse.test.ts` — **new** — unit tests for parsing
- `src/cli/dispatch.test.ts` — **new** — unit tests for dispatch/routing logic
- `test/cli.integration.test.ts` — **new** — integration tests invoking the binary via `Bun.spawn`

## Refactor opportunities

None spotted. Greenfield project.

## Risks / open questions

1. **Resource list for help text** — The top-level `--help` should show available resources. With an empty registry, it'll show none. Should we hardcode the known resources from the spec (product, page, collection, theme, menu, file, shop, config, gql) as "coming soon" placeholders? **Recommendation:** No — just show an empty list or a "No commands registered yet" message. Future tickets add themselves.

2. **`--store` flag parsing** — The flag takes a value (`--store mystore.myshopify.com`). Need to handle `--store=value` and `--store value` forms. This is straightforward but worth a test case.

3. **Short flags** — Spec shows `-j` for `--json`, `-h` for `--help`, `-v` for `--version`. No short forms listed for `--store` or `--no-color`. The AC don't mention short flags explicitly but the spec does. **Recommendation:** Implement them — they're trivial and the spec is authoritative.

## Out of scope

- Output formatting layer (table rendering, JSON envelope) — per ticket
- GraphQL client and authentication — per ticket
- Individual resource command implementations — per ticket
- `.env` file loading and config module — separate ticket (SAU-190 appears to cover config but for a different project; Misty will need its own)
- `misty config show` and `misty gql` commands — later tickets
