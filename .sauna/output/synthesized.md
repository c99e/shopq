# Design: SAU-205 — Project scaffolding & CLI entry point

## Context
This is the foundation ticket for Misty, a Shopify store management CLI designed for AI agents. Nothing exists yet — this ticket creates the Bun project, CLI entry point at `bin/misty.ts`, and the `<resource> <verb>` dispatch skeleton that all future commands plug into. No commands are implemented; this establishes the routing infrastructure. Spec references: "Command Structure", "Global Flags", "Environment" sections of `SPEC.md`.

## Approach

Initialize a Bun project with a hand-rolled argument parser and command registry. The architecture is:

1. **`bin/misty.ts`** — Entry point with shebang (`#!/usr/bin/env bun`). Imports and calls `run()` from `src/cli.ts`. Thin shim — all logic lives in `src/` for testability.

2. **`src/cli.ts`** — Main orchestrator. Flow: parse argv → handle `--version`/`--help` → look up resource/verb in registry → dispatch to command handler or exit with error.

3. **`src/parse.ts`** — Pure function `parseArgs(argv: string[])` that returns `{ resource?, verb?, args[], flags: GlobalFlags }`. Hand-rolled parser (~60 lines):
   - Extracts known global flags: `--json`/`-j`, `--no-color`, `--store <value>`, `--help`/`-h`, `--version`/`-v`
   - Checks `process.env.NO_COLOR` (any value, even empty string) and merges with `--no-color` flag
   - Treats first non-flag arg as resource, second as verb, rest as positional args
   - Handles both `--flag value` and `--flag=value` forms

4. **`src/registry.ts`** — Command registry as `Map<string, Resource>` where `Resource = { name: string, description: string, verbs: Map<string, CommandDef> }`. Empty for now. Provides lookup helpers. Future tickets just call `register(resource, verb, handler)`.

5. **`src/help.ts`** — Generates help text:
   - Top-level: lists available resources and global flags
   - Resource-level: lists verbs for that resource
   - Reads from the registry, so help automatically reflects registered commands

6. **`src/types.ts`** — Shared types: `GlobalFlags`, `ParsedArgs`, `CommandDef`, `Resource`.

**Exit codes:**
- 0 for success, help, version
- 2 for usage errors (unknown resource/verb, bad flags)
- 1 reserved for future runtime/API errors

**Version output:** Import `package.json` and print `version` field.

## Key decisions

1. **Hand-rolled arg parser instead of `util.parseArgs`**
   - Alternatives: Bun's built-in `util.parseArgs`, external library (commander/yargs)
   - Decision: Hand-roll it
   - Rationale: The flag set is small and fixed (5 global flags). `util.parseArgs` with `strict: true` would throw on unknown flags, which breaks when future tickets add command-specific flags (e.g., `--status` on `product list`). Using `strict: false` and manually filtering globals works but adds complexity with no benefit over a custom parser. External libraries violate the "no external dependencies" AC. A ~60 line pure function is simple, fully testable, and avoids future refactoring.

2. **Flat `src/` directory structure, not `src/cli/`**
   - Alternatives: Nest files in `src/cli/`
   - Decision: Flat `src/`
   - Rationale: Only 5 files. Adding a `cli/` subdirectory adds navigation cost for zero organizational benefit. When resource commands arrive (future tickets), they'll live in `src/commands/<resource>.ts` — that's when directories become necessary.

3. **Registry as `Map<string, Resource>` with rich metadata**
   - Alternatives: Plain `Record<string, Record<string, CommandDef>>` or auto-discovery via filesystem
   - Decision: `Map<string, Resource>` where `Resource` includes name, description, and a nested `Map` of verbs
   - Rationale: Richer structure supports better help text (resource descriptions). Explicit registration is simpler and more grep-able than auto-discovery. `Map` is more flexible than `Record` for dynamic registration.

4. **`--store` flag parsing**
   - Decision: Support both `--store value` and `--store=value` forms
   - Rationale: Standard CLI convention. Parser needs to peek ahead when flag expects a value.

5. **Short flags for `-j`, `-h`, `-v` only**
   - Decision: Implement short flags per spec
   - Rationale: Spec explicitly shows `-j` for `--json`, `-h` for `--help`, `-v` for `--version`. No short forms defined for `--store` or `--no-color`, so omit those.

6. **`NO_COLOR` strict spec compliance**
   - Decision: If `NO_COLOR` env var exists (even if empty string), disable color
   - Rationale: Follows the strict no-color.org spec. The env var presence is the signal, not its value. Merge with `--no-color` flag via logical OR.

7. **`CommandDef` interface kept minimal**
   - Decision: `{ description: string; handler: (args: ParsedArgs) => Promise<void> }`
   - Rationale: Future commands need description (for help text) and handler. Additional fields can be added later without breaking existing commands.

## Library / framework evaluation

Nothing applicable. The AC mandate "no external dependencies beyond Bun built-ins." Bun provides:
- `Bun.argv` / `process.argv` for argument access
- `bun test` for testing
- `bun link` for global CLI installation
- Native `.ts` execution via shebang

CLI frameworks (Commander, yargs, Clipanion) would be overkill for a fixed 5-flag parser and would violate the constraint. Bun's `util.parseArgs` was considered but rejected (see Key Decisions #1).

## Files touched

- `package.json` — **new** — name "misty", version "0.1.0", `bin` field pointing to `bin/misty.ts`, scripts (test)
- `tsconfig.json` — **new** — Bun-appropriate TS config (target ES2022, module ESNext)
- `bin/misty.ts` — **new** — shebang entry point, thin shim (~10 lines)
- `src/types.ts` — **new** — `GlobalFlags`, `ParsedArgs`, `CommandDef`, `Resource` interfaces
- `src/parse.ts` — **new** — pure argv parser (~60 lines)
- `src/registry.ts` — **new** — command registry (empty Map, with register/lookup helpers)
- `src/help.ts` — **new** — help text generators (top-level, resource-level)
- `src/cli.ts` — **new** — main orchestrator (parse → route → dispatch/help/error, ~80 lines)
- `tests/parse.test.ts` — **new** — unit tests for parser (flag extraction, resource/verb parsing, NO_COLOR)
- `tests/cli.test.ts` — **new** — integration tests (spawn `bun bin/misty.ts`, assert stdout/stderr/exit codes)
- `.gitignore` — **new** — `node_modules/`, `.env`
- `README.md` — **new** — Minimal setup instructions (bun install, bun link, env vars)

## Refactor opportunities

None. Greenfield project with no existing code.

## Risks / open questions

1. **Empty registry help text** — With no commands registered, `misty --help` will show an empty resource list. Should we hardcode placeholders for known resources from the spec (product, page, collection, theme, menu, file, shop, config, gql)?
   - **Recommendation:** No. Show "No commands registered yet" or an empty list. Future tickets self-register. Hardcoding would require updates here every time a resource is added.

2. **`CommandDef` interface constraints** — Every future command ticket depends on this interface. The proposed minimal shape (`{ description, handler }`) should suffice, but if we discover additional common fields (e.g., command-specific flags, aliases), refactoring will be needed.
   - **Mitigation:** Keep the interface minimal. Add fields only when multiple commands need them.

3. **`bun link` verification** — The AC require `bun link` to install `misty` globally. This needs the correct `bin` field in `package.json` and a valid shebang. Bun natively executes `.ts` files with `#!/usr/bin/env bun`, but this should be integration-tested.

4. **No sibling tickets visible** — Couldn't find other Misty tickets (config/auth, output formatting, gql command). Implementer should confirm the roadmap before finalizing the `CommandDef` interface, in case adjacent tickets have requirements.

## Out of scope

Per ticket and AC:
- Output formatting layer (table rendering, JSON envelope) — separate ticket
- GraphQL client and authentication — separate ticket  
- Individual resource command implementations (product, page, etc.) — future tickets
- `.env` file loading and config module — authentication ticket will handle this
- Error formatting/coloring — belongs in output formatting ticket
- `src/commands/` directory — don't create until first command is implemented

## Arbitration log

### **Topic:** Argument parser implementation
- **Proposals:** 
  - Proposal 1 & 3: Hand-rolled parser
  - Proposal 2: Use Bun's built-in `util.parseArgs`
- **Decision:** Hand-rolled parser
- **Why:** Proposal 2 correctly identifies `util.parseArgs` as a Bun built-in, but acknowledges in its risks section that `strict: true` throws on unknown flags, requiring `strict: false` + manual filtering when command-specific flags are added. This adds complexity with no benefit over a ~60 line custom parser. Hand-rolled is simpler, avoids future refactoring, and remains fully testable as a pure function. The flag surface is small enough that parsing logic is trivial.

### **Topic:** File structure (`src/cli/` vs. flat `src/`)
- **Proposals:**
  - Proposal 1: `src/cli/` subdirectory
  - Proposal 2 & 3: Flat `src/` directory
- **Decision:** Flat `src/`
- **Why:** With only 5 files (cli.ts, parse.ts, registry.ts, help.ts, types.ts), nesting adds navigation cost for no organizational benefit. Two proposals prefer flat structure. Directories become valuable when resource commands are added (`src/commands/`), but that's out of scope.

### **Topic:** Main orchestrator file naming
- **Proposals:**
  - Proposal 1: `dispatch.ts`
  - Proposal 2: `router.ts`
  - Proposal 3: `cli.ts`
- **Decision:** `cli.ts`
- **Why:** `cli.ts` is the clearest name for the main orchestration logic. "Dispatch" and "router" are accurate but more generic. Since this is the top-level CLI entry point (imported by `bin/misty.ts`), `cli.ts` is more immediately understandable.

### **Topic:** Registry data structure
- **Proposals:**
  - Proposal 1: `Map<string, Resource>` where `Resource = { name, description, verbs: Map<string, Command> }`
  - Proposal 2: `Record<string, Record<string, CommandHandler>>`
  - Proposal 3: `Map<string, Map<string, CommandDef>>`
- **Decision:** Proposal 1's approach (Map with rich Resource type)
- **Why:** Including resource-level metadata (name, description) in the registry enables better help text generation. Proposal 2's flat `Record` would require description to live elsewhere or be omitted. `Map` is more flexible for dynamic registration than `Record`. Proposal 1's structure is the most complete.

### **Topic:** `NO_COLOR` environment variable handling
- **Proposals:**
  - Proposal 1: Strict spec (any value, even empty string)
  - Proposal 2: Non-empty value only
  - Proposal 3: Check env var and merge with flag (no specifics on empty string)
- **Decision:** Strict spec (Proposal 1)
- **Why:** The no-color.org spec states presence of the env var disables color, regardless of value. Proposal 1 explicitly addresses this. Following the spec avoids user confusion. Implementation: `!!process.env.NO_COLOR || flags.noColor`.

### **Topic:** File count and separation of concerns
- **Proposals:**
  - Proposal 1 & 3: 5 separate files (cli/dispatch, parse, registry, help, types)
  - Proposal 2: 3 files (router, args, types - combines orchestration and registry)
- **Decision:** 5 files (Proposals 1 & 3)
- **Why:** Separating orchestration (`cli.ts`), parsing (`parse.ts`), registry (`registry.ts`), and help (`help.ts`) improves testability and follows single-responsibility principle. Each file has one clear job. Proposal 2's combination of router + registry is less modular.
