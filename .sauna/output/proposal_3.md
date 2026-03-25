Now I have the full picture. Let me produce the report.

---

# Mistea v1 Milestone Review

## 1. Milestone Summary

**21/21 tickets completed.** Delivered a zero-dependency Shopify Admin CLI built on Bun covering:

- **Foundation (3):** CLI scaffolding with `<resource> <verb>` routing, GraphQL client with auth/retry/error handling, shared output formatting layer
- **Features (18):** Full CRUD for products (list/get/create/update/delete) and pages (list/get/create/update), read-only for collections (list/get), menus (list/get), themes (list), files (list), shop (get), plus `config show` and `gql` escape hatch

**Stats:** ~2,739 LOC source, 261 passing tests, 22 test files, 0 external dependencies.

---

## 2. Gaps Found

| Ticket | Gap | Severity |
|--------|-----|----------|
| SAU-217 (page create) | Spec says `--body` and `--body-file` mutually exclusive with exit code 2 — **implemented correctly** ✅ (my earlier concern was wrong, code validates this at line 30-33 of page.ts) | None |
| SAU-206 (GraphQL client) | No fetch timeout — a hung Shopify endpoint blocks forever | **Medium** |
| SAU-220 (product create) | Options step creates placeholder `"Default"` values per option; these may remain as ghost data after variant bulk create | **Medium** |
| SAU-220 (product create) | Rollback swallows errors silently (`catch {}`) — if rollback fails, user gets no feedback that an orphaned product exists | **Low** |
| All list commands | No `--limit` floor validation — `--limit 0` or `--limit -1` sends invalid values to Shopify API | **Low** |
| SAU-224 (product delete) | Missing `--yes` exits code 0 (dry run) — correct per spec, but JSON dry-run output has no `"dryRun": true` flag to distinguish from actual deletion | **Low** |
| SAU-205 (scaffolding) | README.md has no setup/install instructions — only SPEC.md and CLAUDE.md exist | **Low** |
| All commands | `HttpError` for non-429/non-200 responses dumps raw body text — no structured error parsing | **Low** |
| SAU-207 (output) | Table formatter doesn't handle values with newlines or very long strings — could break alignment | **Low** |

---

## 3. Suggestions

| Area | Suggestion | Rating | Rationale |
|------|-----------|--------|-----------|
| **Boilerplate: client init** | Extract `getClient(flags)` helper — the 3-line `resolveConfig` + `MISTY_PROTOCOL` + `createClient` pattern is copy-pasted **17 times** across all command handlers | 🟢 Do now | ~50 lines of pure duplication; one-function extraction |
| **Boilerplate: error handling** | Extract `withErrorHandling(fn)` wrapper — every handler has identical `try/catch` for `ConfigError`/`GraphQLError` (~10 lines × 17 handlers) | 🟢 Do now | Mechanical extraction, eliminates ~170 lines of duplication |
| **Fetch timeout** | Add `signal: AbortSignal.timeout(30_000)` to the fetch call in `graphql.ts` | 🟢 Do now | One line change; prevents indefinite hangs |
| **Limit validation** | Clamp `--limit` to `[1, 250]` in all list handlers (or in the shared helper after extraction) | 🟢 Do now | One-liner per handler; prevents Shopify API errors |
| **README** | Write user-facing README with install, env setup, and usage examples | 🟢 Do now | No onboarding docs exist |
| **Arg parsing** | Replace hand-rolled if/else flag parser (134 lines of repetitive branches in `parse.ts`) with a data-driven approach: define flags as an array, loop over them | 🟡 Do soon | Each new flag requires 4 lines of copy-paste; fragile for v2 expansion |
| **Types: GlobalFlags** | `GlobalFlags` is a flat bag of every flag from every command — consider per-command flag types or `Record<string, string>` with validated access | 🟡 Do soon | Every new command pollutes the global type; will worsen in v2 |
| **Product create options** | After variant bulk create, clean up placeholder `"Default"` option values, or derive initial values from the variants JSON | 🟡 Do soon | Could leave ghost option values visible in Shopify admin |
| **Rollback feedback** | Log a warning to stderr if rollback `productDelete` itself fails, including the orphaned product ID | 🟡 Do soon | Silent failure leaves orphaned products with no trace |
| **CI** | Add GitHub Actions workflow running `bun test` | 🟡 Do soon | No CI means regressions can slip in |
| **Product update mutation** | `productUpdate` uses `ProductInput!` — Shopify is migrating to `productSet`; monitor deprecation timeline | 🔴 Too early | Works on `2026-01` API version; revisit at next version bump |
| **Test architecture** | Tests use subprocess spawning — fine at 261 tests / 5.6s; consider in-process imports if it slows | 🔴 Too early | Not a problem yet |

---

## 4. Recommended Next Steps

**Do now (before next milestone):**

1. **Extract `getClient(flags)`** — Single helper in `src/client.ts` replacing the repeated `resolveConfig` + protocol + `createClient` trio in every handler
2. **Extract `withErrorHandling(handler)`** — Wraps handlers with the standard `ConfigError`/`GraphQLError` catch block
3. **Add fetch timeout** — `signal: AbortSignal.timeout(30_000)` in `graphql.ts`
4. **Clamp `--limit` to `[1, 250]`** — Add `Math.max(1, Math.min(limit, 250))` 
5. **Write README.md** — Install, env vars, quick examples

**Do soon (early v2):**

6. Refactor `parse.ts` to data-driven flag definitions
7. Split `GlobalFlags` into base + per-command types
8. Fix product create option placeholder values
9. Add warning on rollback failure
10. Set up CI
