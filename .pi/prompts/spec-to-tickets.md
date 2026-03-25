---
description: Break a spec into Linear tickets (one at a time, with dependencies)
---
You are breaking down a spec into Linear tickets for the **$2** project.

Use `linear` for all Linear operations. Tickets will be picked up by a TDD / implement agent — they need enough context and specificity to be resolved without further discussion.

## Workflow

1. **Study the spec at `$1`** — read the full document. Map out the dependency graph between pieces of work.
2. **Check existing state** — list milestones and issues under the project to find the starting point. Create the milestone if it doesn't exist.
3. **Study the codebase** — read the files the next ticket would touch. Understand current interfaces, naming, and state.
4. **Identify one ticket** — pick the next logical ticket based on dependencies (foundational / no-blocker pieces first).
5. **Ask questions** — clarify scope, priority, or ambiguities with the user before drafting.
6. **Draft the ticket** — present the full draft and wait for explicit confirmation before creating.
7. **Create and link** — create the issue, then add dependency relations to any prerequisite tickets.

## Ticket structure

Each ticket should include:

- **Summary** — what and why, 2–3 sentences. Communicate intent, not implementation.
- **Spec reference** — point to the spec file and relevant sections so the agent reads the source of truth at resolve time (the codebase may have changed since ticket creation).
- **Acceptance criteria** — checkboxes, specific and testable. See "AC guidance" below.
- **Testing guidance** — what *kind* of tests (unit, property-based, integration), not exact code.
- **Out of scope** — what is explicitly deferred to later tickets.

Do NOT include implementation steps, code snippets, or file paths — the agent will discover these from the codebase and spec when it picks up the ticket.

## AC guidance

Acceptance criteria should constrain the **boundary and contract**, not the implementation. The implementing agent will read the codebase at resolve time and is better positioned to make design decisions than we are at ticket-creation time.

**Good AC** (what to verify):
- "The reducer is a pure function, exported from its own module, and unit-tested without React"
- "The hook's public return type is unchanged"
- "Conversation state remains as `useState` — it spans across runs and is a separate concern"

**Bad AC** (implementation decisions disguised as checkboxes):
- "Eliminate `accumulatedTextRef` — the reducer holds accumulated text in state"
- "Typed action discriminants map to SSE events: `proposer:token`, `proposer:done`, …"
- "Move `settledSuccessfulRef` and `settledFailedRef` into reducer state"

The first set tells the agent *what outcomes matter*. The second pre-decides tradeoffs the agent should discover from the code. If the AC reads like a design doc, it's too detailed — the agent will follow it rigidly instead of doing TDD.

**Where detail IS valuable:**
- **Out of scope** — prevents scope creep the agent can't judge on its own.
- **Constraints / contracts** — "public API unchanged", "no new dependencies", "this state stays separate because X".
- **Intent / why** — the summary should explain the problem being solved so the agent can make good tradeoff calls.

## Defaults

- **Priority** — make a judgement call, confirm with user
- **Labels** — run `linear project list` to find the project's team, then `linear label list --team <TEAM_KEY>` to see available labels. Create new ones with `linear label create` if none fit.
- **State** — Backlog

## Usage

```
/spec-to-tickets docs/my-spec.md <project-name>
```

Example:
```
/spec-to-tickets docs/my-spec.md Mistea
```
