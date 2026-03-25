# Design: SAU-205 — Project scaffolding & CLI entry point

## Context
This is the very first ticket for the Misty CLI — a Shopify store management CLI designed for AI agents. It sets up the Bun project from scratch, creates the `<resource> <verb>` dispatch skeleton, global flag parsing, and help/version output. No commands are implemented; this creates the structure they plug into. Spec references: "Command Structure", "Global Flags", "Environment" sections of `SPEC.md`.

## Approach
Initialize a Bun project with a single entry point at `bin/misty.ts` that parses argv into `{ resource, verb, args, flags }`, looks up a command registry (initially empty), and either dispatches or prints help/errors. The registry is a simple `Map<string, Map<string, CommandDef>>` where commands register themselves — future tickets just add entries.

**Structure:**
```
package.json          — name "misty", bin field pointing to bin/misty.ts
bin/misty.ts          — shebang entry, calls run() from src/cli.ts
src/cli.ts            — orchestrator: parse → route → execute (or help/error)
src/parse.ts          — pure function: argv → ParsedArgs
src/registry.ts       — command registry type + empty registry
src/help.ts           — help text generators (top-level, resource-level)
src/types.ts          — shared types (GlobalFlags, ParsedArgs, CommandDef)
tests/parse.test.ts   — unit tests for arg parsing
tests/cli.test.ts     — integration tests invoking the binary
```

The parser is a hand-rolled function (no library) that:
1. Extracts known global flags (`--json`, `--no-color`, `--store <value>`, `--help`/`-h`, `--version`/`-v`)
2. Checks `NO_COLOR` env var and merges with `--no-color`
3. Treats first non-flag arg as resource, second as verb, rest as positional args
4. Returns a `ParsedArgs` object

Routing logic in `cli.ts`:
- `--version` → print version from `package.json`, exit 0
- `--help` (no resource) → print top-level help, exit 0
- resource + `--help` (no verb) → print resource help listing verbs, exit 0
- unknown resource or verb → stderr error message, exit 2
- valid resource + verb → call command handler (placeholder for now)

## Key decisions

1. **Hand-rolled arg parser vs. library** — Hand-roll it. The flag set is small and fixed (5 global flags). `Bun.argv` gives us the raw array. A library would be the only external dep and the ticket explicitly says "no external dependencies beyond Bun built-ins." The parsing logic is ~50 lines and fully unit-testable as a pure function.

2. **Command registry as a static map vs. dynamic discovery** — Static map. Each resource module will export its commands and register them in a central `registry.ts` file. Simpler than filesystem scanning, explicit, and easy to tree-shake. Future command tickets just add an import + registry call.

3. **`bin/misty.ts` as thin shim** — The bin file should only contain the shebang (`#!/usr/bin/env bun`), import `run` from `src/cli.ts`, and call it. All logic lives in `src/` for testability.

4. **Exit codes** — 0 for success/help/version, 2 for usage errors (unknown resource/verb), matching the AC and common CLI conventions (2 = misuse).

5. **`--store` flag takes a value** — Per spec, `--store` is a "one-off store override." Parse it as `--store <value>` (next arg). Don't validate the store value in this ticket — that's for the config/auth ticket.

6. **Short flags** — Spec shows `-j` for `--json`, `-h` for `--help`, `-v` for `--version`. Support these. No short form for `--store` or `--no-color` (spec doesn't define any).

## Library / framework evaluation

Nothing worth evaluating. The spec mandates "no external dependencies beyond Bun built-ins," the flag surface is trivially small, and Bun's test runner covers testing needs. A CLI framework (Commander, yargs, Clipanion) would be overkill for a fixed 5-flag parser and would violate the constraint.

## Files touched
- `package.json` — **new** — project metadata, `bin` field, `scripts` (test, etc.)
- `tsconfig.json` — **new** — Bun-appropriate TypeScript config
- `bin/misty.ts` — **new** — shebang entry point, thin shim
- `src/types.ts` — **new** — `GlobalFlags`, `ParsedArgs`, `CommandDef` interfaces
- `src/parse.ts` — **new** — pure argv parser
- `src/registry.ts` — **new** — command registry (empty, with type and lookup helper)
- `src/help.ts` — **new** — help text formatting functions
- `src/cli.ts` — **new** — main orchestrator (parse → route → dispatch/help/error)
- `tests/parse.test.ts` — **new** — unit tests for parser
- `tests/cli.test.ts` — **new** — integration tests (spawn binary, assert stdout/stderr/exit code)

## Refactor opportunities
None spotted. Greenfield project — no existing code.

## Risks / open questions

1. **No sibling tickets visible** — I couldn't find other Misty tickets in Linear. The implementer should confirm whether tickets for config/auth, output formatting, and `gql` command exist or need to be created. The `CommandDef` interface designed here will constrain those tickets.

2. **`CommandDef` interface shape** — Needs to be designed carefully since every future command depends on it. Suggest keeping it minimal: `{ description: string; handler: (args: ParsedArgs) => Promise<void> }`. Can be extended later. The risk is low since there are no commands yet.

3. **`bun link` behavior** — Requires the `bin` field in `package.json` to point to `bin/misty.ts` and the file to have a shebang. Bun handles `.ts` shebangs natively, so `#!/usr/bin/env bun` works. Verify on the target machine.

## Out of scope
- Output formatting layer (table rendering, JSON envelope) — per ticket
- GraphQL client and authentication — per ticket
- Individual resource command implementations — per ticket
- Store/config validation (`.env` loading, `MISTY_STORE` / `MISTY_ACCESS_TOKEN`) — config ticket
- Actually dispatching to real commands — this ticket only builds the routing skeleton
