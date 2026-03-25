You are reviewing a CLI specification before it gets broken down into implementation tasks.

Read SPEC.md in this directory. Your job is technical architect review.

## North Star

Use **12 Factor CLI Apps** (Jeff Dickey / Heroku oclif) and **clig.dev** (Command Line Interface Guidelines) as your reference standard. Flag anything in the spec that violates these principles, and flag anything these principles call for that the spec doesn't address.

## Review Dimensions

1. **Gaps** — Missing flags, edge cases, or unspecified behaviors.
2. **Contradictions** — Commands or behaviors that conflict with each other.
3. **API validation** — Verify commands map correctly to Shopify's Admin GraphQL API (2026-01). Flag anything that doesn't exist or works differently.
4. **Acceptance criteria quality** — Are they testable and unambiguous?
5. **Complexity honesty** — Flag anything that sounds simple but isn't.
6. **Simplifications** — Anything over-specified or deferrable for v1?
7. **CLI best practices compliance** — Evaluate against the north star references.

Output a structured review with sections for each dimension. For each finding, reference the specific spec section and suggest a fix. Don't rewrite the spec — just list findings.
