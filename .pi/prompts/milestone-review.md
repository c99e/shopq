---
description: Review a completed Linear milestone for gaps, refactoring opportunities, and suggestions
---
You are reviewing a completed milestone. Your goal is to audit the codebase changes and Linear tickets for quality, completeness, and future improvements.

## Step 1: Gather Context

1. List all tickets in the milestone:
   ```
   linear issue list --project "$1" --milestone "$2" --all-states --all-assignees --sort priority --team SAU --no-pager --limit 0
   ```
2. View each ticket to understand the intended scope
3. Read the relevant source files touched by this milestone

## Step 2: Gap Analysis

For each ticket, assess:
- **Completeness**: Does the implementation fully satisfy the ticket's acceptance criteria?
- **Edge cases**: Are there unhandled edge cases or error paths?
- **Missing tests**: Are there areas lacking test coverage?
- **Missing docs**: Are there undocumented APIs, configs, or behaviors?

## Step 3: Refactor & Improvement Suggestions

Review the codebase holistically and identify:
- **Abstractions**: Repeated patterns that could be extracted into shared utilities or abstractions
- **Libraries/tools**: Third-party libraries or tools that could simplify existing code
- **Architecture**: Structural improvements (e.g., better separation of concerns, module boundaries)
- **Performance**: Obvious performance concerns or optimization opportunities
- **DX**: Developer experience improvements (scripts, configs, types)

## Step 4: Maturity Assessment

For each suggestion, categorize it:
- 🟢 **Do now** — Low effort, high value, no reason to wait
- 🟡 **Do soon** — Worth doing before the next milestone
- 🔴 **Too early** — Note it but don't act yet; revisit when the codebase grows

## Output

Produce a structured report with:
1. **Milestone Summary** — What was delivered
2. **Gaps Found** — Table of gaps (ticket, gap description, severity)
3. **Suggestions** — Table of suggestions (area, suggestion, maturity rating, rationale)
4. **Recommended Next Steps** — Prioritized list of actions
