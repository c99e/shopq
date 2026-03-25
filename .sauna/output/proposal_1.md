I have everything I need. Here's the full audit report:

---

# Mistea v1 — Milestone Audit Report

## 1. Milestone Summary

**21 tickets delivered, all Done.** Mistea is a Shopify Admin CLI built for AI agents on Bun with zero external dependencies.

| Category | Tickets | What shipped |
|----------|---------|-------------|
| Foundation (3) | SAU-205, 206, 207 | CLI scaffolding with `<resource> <verb>` routing, GraphQL client with 429 retry/backoff, table + JSON output formatting |
| Product CRUD (5) | SAU-212, 213, 220, 223, 224 | list, get, create (multi-variant with rollback), update, delete (with `--yes` safety) |
| Page CRUD (4) | SAU-215, 217, 218, 219 | list, get, create, update — with SEO metafields and `--body-file` |
| Read-only resources (7) | SAU-210, 211, 214, 216, 221, 222, 225 | shop get, theme list, menu list/get, file list, collection list/get |
| Utilities (2) | SAU-208, 209 | config show, raw `gql` escape hatch (inline, stdin, file) |

**Stats:** 2,739 LOC source (16 files), 4,402 LOC tests (22 files), 261 tests passing, 666 assertions.

---

## 2. Gaps Found

| Ticket | Gap | Severity |
|--------|-----|----------|
| **7 commands** (product get/update/delete, menu get, page get/update, collection get) | Usage errors (missing required arg) exit with code **1** instead of spec'd code **2** | Medium — agents may rely on exit codes to distinguish usage vs runtime errors |
| SAU-220 (product create) | `Bun.file(flags.variants).json()` has no try-catch — missing/invalid file throws unformatted Bun exception instead of `formatError` | Medium |
| SAU-217 (page create) | `--body-file` has same issue — no try-catch around `Bun.file().text()` | Medium |
| SAU-209 (gql) | `gql` correctly checks `file.exists()` before reading — but **no other command does this** for file flags | Low |
| SAU-206 (GraphQL client) | No `fetch()` timeout — a hung Shopify endpoint blocks the process indefinitely | Medium |
| SAU-207 (output) | Table formatter doesn't handle multi-line cell values or extremely long strings — columns blow out | Low |
| SAU-218 (page update) | JSON output wraps `updatedFields` as `{ data: ["title", "body"] }` — spec says "returns list of updated field names as a JSON array" (top-level array) | Low |
| SAU-208 (config show) | JSON output includes masked token — spec says "masks **or omits**" — acceptable but worth noting the token's last 4 chars are visible | Info |
| All commands | `MISTY_PROTOCOL` env var used everywhere for testing but completely undocumented | Low |
| SAU-205 (scaffolding) | README.md is still the `bun init` boilerplate — no usage docs, no setup guide | Medium |

---

## 3. Suggestions

| Area | Suggestion | Rating | Rationale |
|------|-----------|--------|-----------|
| **Error handling** | Extract `handleCommandError(err)` — the `catch { if ConfigError… if GraphQLError… throw }` block is copy-pasted **18 times** across commands | 🟢 Do now | Pure mechanical duplication; 5-line helper eliminates ~90 lines |
| **Client creation** | Extract `createClientFromFlags(flags)` — the 3-line `resolveConfig` + `MISTY_PROTOCOL` + `createClient` pattern repeats in every handler | 🟢 Do now | DRY; also centralizes the undocumented protocol override |
| **Exit codes** | Fix 7 usage-error paths from exit code 1 → 2 | 🟢 Do now | Spec compliance; 7 one-line changes |
| **File read safety** | Wrap `Bun.file().json()` / `.text()` in try-catch with friendly errors for `--variants`, `--body-file` | 🟢 Do now | Prevents unformatted stack traces reaching agents |
| **Arg parser** | Replace 134-line if/else chain with table-driven flag definitions. Each flag is ~6 lines of duplicated pattern. | 🟡 Do soon | Every new flag = copy-paste; refactor before v2 adds flags |
| **Product ID resolution** | Extract shared `resolveToGid(client, idOrTitle, resourceType)` — the resolve + search + disambiguate pattern repeats in product get/update/delete | 🟡 Do soon | ~50 lines × 3 commands |
| **Fetch timeout** | Add `signal: AbortSignal.timeout(30_000)` to `graphql.ts` fetch | 🟡 Do soon | 1-line fix, prevents indefinite hangs |
| **README** | Write real README with env setup, `bun link`, command reference, examples | 🟡 Do soon | Current README is `bun init` boilerplate |
| **Menu list pagination** | `menu list` hardcodes `first: 250` with no `--limit`/`--cursor` — inconsistent with other list commands | 🟡 Do soon | Spec says "all list commands use cursor-based pagination" |
| **Help for `_default` commands** | `misty gql --help` falls through to showing the resource help but the `_default` verb shows as a listed verb name | 🟡 Do soon | Minor UX polish |
| **Integration smoke tests** | Add env-gated tests against a real Shopify dev store | 🔴 Too early | Needs a test store; revisit at v2 |
| **Auto-discovery** | Auto-import `src/commands/*.ts` instead of manual list in `bin/misty.ts` | 🔴 Too early | 9 imports is manageable; revisit at 15+ commands |
| **`--all` pagination** | Flag to auto-paginate through all pages of results | 🔴 Too early | Not in v1 spec; useful later for bulk agent workflows |

---

## 4. Recommended Next Steps

**Do now (before any v2 work):**

1. **Fix exit codes** — 7 usage-error paths need `process.exitCode = 2` instead of `1` (~5 min)
2. **Extract `handleCommandError`** — one shared catch handler, delete 18 duplicated blocks (~15 min)
3. **Extract `createClientFromFlags`** — centralize client creation + protocol override (~10 min)
4. **Add file-read try-catch** — wrap `Bun.file()` calls in `--variants` and `--body-file` paths (~10 min)

**Do soon (before v2 ships):**

5. **Table-driven arg parser** — replace the if/else chain with a flag definition map (~30 min)
6. **Extract `resolveToGid`** — shared product/collection ID resolution (~20 min)
7. **Add fetch timeout** to GraphQL client (~2 min)
8. **Write a real README** with setup, usage, and command reference (~30 min)
9. **Add `--limit`/`--cursor` to `menu list`** for spec consistency (~10 min)

Items 1–4 are mechanical and risk-free — good candidates to batch into a single cleanup PR before starting v2.
