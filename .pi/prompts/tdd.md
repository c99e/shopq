---
description: Implement work using Test-Driven Development (Red-Green-Refactor)
---

Implement the requested work using Test-Driven Development.

**Work to implement:** $@

## Phase 0 — Understand

1. List all acceptance criteria as checkboxes
2. Identify the affected files and modules in the codebase
3. Note any dependencies or blockers
4. Identify edge cases to test: null/undefined, empty arrays, boundary values, error states

---

## Phase 1 — Red (Write Failing Tests)

Write failing tests that define the behavior. Follow codebase conventions (naming, mocks, describe/it style).

- Each test name states the **behavior**, not the implementation
- Consider property-based tests where an invariant holds across a whole class of inputs (passthrough guarantees, format/shape invariants, boundary ranges, error propagation). Only add if it catches something example-based tests wouldn't
- Tests must fail because **the implementation is missing** — not because of a bad import or broken mock
- Run `bun run test` and confirm: new tests fail, existing tests still pass
- If a test passes before you've written any implementation, it's a false green — fix it

**Test Quality:**
- Cover critical paths, not 100% coverage for its own sake
- Test edge cases: null/undefined, empty arrays, boundary values, error states
- Each test should verify one specific behavior

---

## Phase 2 — Green (Make Tests Pass)

Implement the **minimum code** to make the tests pass. DON'T WRITE CODE THAT NO TEST REQUIRES!

- Run `bun run test` after each meaningful increment
- If a test failure points to a genuine test bug (wrong import, typo), fix it and note what changed — don't modify tests to hide implementation shortcomings
- Keep going until `bun run test` exits 0

---

## Phase 3 — Refactor (Clean Up)

Clean up the code while keeping all tests green.

- Extract duplicated logic into helper functions
- Improve naming for clarity
- Remove dead code or commented-out experiments
- Simplify complex conditionals
- Run `bun run test` after each refactor to ensure nothing breaks
- Don't add new behavior — that requires a new red test first

---

## Complete

Once all phases are done:

1. Verify all acceptance criteria are met
2. Provide a summary of what was implemented
