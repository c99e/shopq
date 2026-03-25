# Mistea v1 — Synthesized Milestone Audit

## 1. Milestone Summary

**21/21 tickets completed.** All three reviews agree: Mistea v1 ships a zero-dependency Shopify Admin CLI on Bun with full coverage of the spec.

| Category | Tickets | Shipped |
|----------|---------|---------|
| Foundation (3) | SAU-205, 206, 207 | CLI scaffolding, GraphQL client with 429 retry/backoff, table + JSON output |
| Product CRUD (5) | SAU-212, 213, 220, 223, 224 | list, get, create (multi-variant + rollback), update, delete (`--yes` safety) |
| Page CRUD (4) | SAU-215, 217, 218, 219 | list, get, create, update — SEO metafields, `--body-file` |
| Read-only (7) | SAU-210, 211, 214, 216, 221, 222, 225 | shop get, theme list, menu list/get, file list, collection list/get |
| Utilities (2) | SAU-208, 209 | config show, raw `gql` escape hatch |

**Stats:** ~2,739 LOC source (16 files), 261 tests passing across 22 test files, 0 external dependencies.

---

## 2. Gaps Found

All three reviews converge on the same core issues. Disagreements are noted inline.

| Gap | Severity | Agreement |
|-----|----------|-----------|
| **Exit code 1 vs 2 for usage errors** — 7 commands return exit code 1 on missing required args instead of spec'd code 2 | **Medium** | 2/3 reviews flag this; the third doesn't mention it but doesn't contradict |
| **No fetch timeout** — hung Shopify endpoint blocks the process indefinitely | **Medium** | All three agree |
| **Unsafe `Bun.file()` reads** — `--variants` (product create) and `--body-file` (page create) have no try-catch; missing/invalid files throw unformatted exceptions | **Medium** | 2/3 flag explicitly; third notes rollback-related file handling but not this specific path |
| **Title quoting bug** — product get/update/delete may fail on titles with spaces | **Medium** | Raised by 1 review only — **needs verification**; the other two don't mention it, so this may be a false positive or edge case |
| **Product create placeholder options** — creates `"Default"` option values that may persist as ghost data after variant bulk create | **Medium** | 1 review raises; others don't contradict |
| **No `--limit`/`--cursor` on `menu list`** — hardcodes `first: 250`, inconsistent with other list commands | **Low** | 2/3 flag this |
| **No `--limit` floor validation** — `--limit 0` or `-1` sends invalid values to Shopify API | **Low** | 1 review raises; valid concern |
| **Rollback swallows errors silently** — if product create rollback fails, no feedback about orphaned product | **Low** | 1 review raises; valid concern |
| **Table formatter** doesn't handle multi-line values or very long strings | **Low** | 2/3 mention |
| **Page update JSON output** wraps `updatedFields` as `{ data: [...] }` instead of spec'd top-level array | **Low** | 1 review |
| **README.md** is still `bun init` boilerplate — no setup/usage docs | **Medium** | All three agree |
| **`MISTY_PROTOCOL` env var** used everywhere for testing but undocumented | **Low** | 1 review; resolved by client extraction below |

---

## 3. Suggestions

Strong consensus across all three reviews on the top items. Merged and deduplicated:

| Area | Suggestion | Rating | Notes |
|------|-----------|--------|-------|
| **Extract `getClient(flags)`** | Centralize the 3-line `resolveConfig` + `MISTY_PROTOCOL` + `createClient` pattern repeated 17–18× | 🟢 Do now | **All three agree** — eliminates ~50 lines of duplication and centralizes protocol override |
| **Extract `handleCommandError(err)`** | One shared catch handler for the identical `ConfigError`/`GraphQLError` try-catch block repeated 17–18× | 🟢 Do now | **All three agree** — eliminates ~170 lines of duplication |
| **Fix exit codes 1 → 2** | 7 usage-error paths need `process.exitCode = 2` | 🟢 Do now | 7 one-line changes for spec compliance |
| **Add fetch timeout** | `signal: AbortSignal.timeout(30_000)` in `graphql.ts` | 🟢 Do now | **All three agree** — 1-line fix |
| **File-read try-catch** | Wrap `Bun.file()` in `--variants` and `--body-file` paths | 🟢 Do now | Prevents unformatted stack traces reaching agents |
| **Clamp `--limit` to [1, 250]** | Validate limit floor in list commands | 🟢 Do now | Prevents invalid Shopify API requests |
| **Write README** | Install, env setup, command reference, examples | 🟢 Do now | All three flag the missing docs |
| **Table-driven arg parser** | Replace 134-line if/else flag chain with data-driven definitions | 🟡 Do soon | 2/3 recommend; important before v2 adds flags |
| **Extract `resolveToGid`** | Shared product/collection ID resolution (~50 lines × 3 commands) | 🟡 Do soon | 1 review; valid DRY improvement |
| **Split `GlobalFlags`** | Per-command flag types instead of a flat bag | 🟡 Do soon | 1 review; will worsen as commands grow |
| **Fix product create option placeholders** | Clean up or derive initial option values from variants JSON | 🟡 Do soon | 1 review; prevents ghost data in Shopify admin |
| **Rollback failure warning** | Log orphaned product ID to stderr if rollback fails | 🟡 Do soon | 1 review; low effort, high debugging value |
| **Add `--limit`/`--cursor` to `menu list`** | Spec consistency with other list commands | 🟡 Do soon | 2/3 flag |
| **Set up CI** | GitHub Actions running `bun test` | 🟡 Do soon | 1 review; standard practice |
| **Integration smoke tests** | Env-gated tests against a real Shopify dev store | 🔴 Too early | Needs test store infrastructure |
| **Auto-discovery of commands** | Auto-import `src/commands/*.ts` | 🔴 Too early | 9 imports is manageable |
| **Migrate to `productSet`** | Shopify deprecation of `ProductInput!` | 🔴 Too early | Works on `2026-01` API version |

---

## 4. Recommended Next Steps

### Do now (batch into one cleanup PR before v2)

1. **Extract `getClient(flags)`** — single helper replacing repeated client init (~10 min)
2. **Extract `handleCommandError`** — shared catch handler, delete 17–18 duplicated blocks (~15 min)
3. **Fix exit codes** — 7 one-line changes, code 1 → 2 for usage errors (~5 min)
4. **Add fetch timeout** — `AbortSignal.timeout(30_000)` in `graphql.ts` (~2 min)
5. **Add file-read try-catch** — `--variants` and `--body-file` paths (~10 min)
6. **Clamp `--limit`** to `[1, 250]` in list handlers (~5 min)
7. **Write README.md** (~30 min)

**Estimated total: ~75 min of mechanical, low-risk work.**

### Do soon (early v2)

8. Table-driven arg parser refactor
9. Extract shared `resolveToGid` helper
10. Split `GlobalFlags` into per-command types
11. Fix product create option placeholders
12. Add rollback failure warning
13. Add `--limit`/`--cursor` to `menu list`
14. Set up CI

### Unresolved / Needs verification

- **Title quoting bug** (raised by 1/3 reviews): Verify whether product get/update/delete actually fails on titles with spaces before prioritizing a fix.
