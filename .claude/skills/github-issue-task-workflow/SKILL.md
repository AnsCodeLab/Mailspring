---
name: github-issue-task-workflow
description: Use when the user wants to implement a GitHub issue — fetches issue context, plans and gets the plan reviewed before coding on anything non-trivial, creates a feature branch from master, writes tests first, implements with issue-referencing commits, creates and processes test cases, verifies by running (not just reading), gets an independent code review before pushing, pushes, creates a GitHub Pull Request, and loops on CI/review until it merges. Also use when user says "work on issue", "implement this GitHub issue", or provides an issue number to work on.
---

# GitHub Issue Task Workflow — Mailspring

## Overview

Full lifecycle for implementing a GitHub issue: fetch → scope → plan review → branch → write tests → implement → create/process test cases → verify → independent review → push → PR → CI/review loop until merged → report on the issue.

**Do not merge directly to master.** Always create a GitHub PR so CI runs and review happens.

Repo: `AnsCodeLab/Mailspring` (`gh` CLI is authenticated for this repo — confirm with `gh repo view AnsCodeLab/Mailspring` if unsure). Default branch: `master`.

---

## Proportionality first

Not every issue needs the full ceremony below.

- **Trivial** (copy fix, config value, one-line guard, obvious typo, no architectural decision to make): fetch → branch → implement → verify → push → PR → CI loop → report on the issue. Skip the Plan Review gate, Write Tests First, Create/Process Test Cases, and the Independent Review gate.
- **Real change** (new behavior, a bug whose root cause isn't obvious from the issue alone, anything touching more than one file in a load-bearing way): run every step below, including both gates.

When unsure which bucket an issue is in, treat it as Real. Skipping a gate on an issue that turns out to need it is the expensive direction to be wrong in; the reverse costs one extra review pass.

## Model roles

- **Orchestrator — `anthropic/claude-fable-5`**: the main session runs the flow — issue handling, planning, git/PR mechanics, issue comments — and both review gates are pinned to it.
- **Implementor — `anthropic/claude-sonnet-5`**: the hands-on-code work (steps 7–9: failing tests, implementation, test cases) is delegated to a subagent pinned to it via `eval`: `agent(spec, model="anthropic/claude-sonnet-5")`. The orchestrator session does not write implementation code inline.
- The `task` tool has no per-item model override — model pinning only works through `eval`'s `agent(prompt, model=…)` bridge.
- Harness note: the `eval` `agent()` bridge and these model ids exist in the Oh My Pi harness. On plain Claude Code, run the gates as Task subagents without model pinning — the isolation discipline (cold reviewer, no implementer summary) matters more than the model split; keep that even when pinning isn't available.

---

## Step-by-Step Flow

### 1. Fetch the Issue

```bash
gh issue view N --repo AnsCodeLab/Mailspring --json number,title,body,state,labels,assignees,milestone,comments
```

Read carefully:
- Title and full body
- Any linked/parent issue mentioned in the body (task lists, "part of #NNN") for broader context
- Existing comments (may contain decisions or constraints)
- Labels (bug/enhancement/priority) and milestone

If the description is unclear or missing detail — **ask before starting**. A wrong implementation wastes more time than a clarifying question.

### 2. Claim the Issue and Mark In Progress

Check the `assignees` field from step 1's fetch:
- **Unassigned**: claim it — `gh issue edit N --repo AnsCodeLab/Mailspring --add-assignee @me`. Working an unassigned issue without claiming it means the next person who looks at the tracker has no idea it's in progress.
- **Assigned to someone else**: don't silently reassign — another developer may already be on it. Ask the user before taking it.
- **Already assigned to you**: no-op, proceed.

GitHub issues have no built-in "in progress" status field (unless this repo wires up a Projects board — it currently doesn't). The assignee **is** the claim signal. Make it durable with a comment as well, so anyone reading the issue thread — not just the sidebar — sees it:

```bash
gh issue comment N --repo AnsCodeLab/Mailspring --body "Starting implementation."
```

If the repo has an `in-progress`-style label, apply it too (`gh label list --repo AnsCodeLab/Mailspring` to check); don't invent a label convention that doesn't already exist.

### 3. Scope and Plan (Real issues only)

Before touching code, write down: which files/modules this touches, the approach, and any open questions. Write it to `docs/issues/N/plan.md` — not just the model's own head — so the next step can review it independently. Commit it as the first commit on the feature branch (created in step 5), so the plan that was reviewed becomes part of the PR's history.

For Trivial issues, skip straight to step 5.

### 4. Gate: Plan Review (Real issues only)

Have an independent pass, a fresh subagent given only the plan from step 3, not the reasoning that produced it, review the approach before any code is written: is this the right module boundary, does it touch anything the issue didn't intend, is there a simpler path. Catching a bad approach here costs a rewrite of a few paragraphs. Catching it after step 8 costs a rewrite of the branch.

Run this through the `eval` tool's `agent()` bridge, not the `task` tool (see Model roles). Give the reviewer the contents of `docs/issues/N/plan.md` and nothing else: `agent(planDoc, model="anthropic/claude-fable-5")`. Append the reviewer's verdict (and any changes it forced) to `plan.md` so the gate leaves a trace.

### 5. Create Branch from Master

```bash
git checkout master
git pull origin master
git checkout -b issue-N-brief-slug
```

**Branch naming:** `issue-N-brief-slug`
- `N` = GitHub issue number, no padding
- Examples: `issue-1-folder-unread-count`, `issue-42-tls13-imap`
- Slug: 3–5 words, hyphenated, lowercase

`gh issue develop N --repo AnsCodeLab/Mailspring --checkout` also works and links the branch to the issue automatically — prefer it when available, it saves the manual link in step 13.

### 6. Read Context Before Coding

Always read before touching code:
- `CLAUDE.md` — project-level instructions (build/test commands, architecture, flux/task/sync-engine model)
- `CONTRIBUTING.md` — contribution and coding conventions
- Relevant source files identified from the issue description — remember app code lives in **both** `app/src/` and `app/internal_packages/`; search both

### 7. Write Tests First (Real issues only)

Real issues: steps 7–9 are the implementor's job — delegate to the implementor subagent (see Model roles) with a complete spec: the reviewed plan doc, the issue's acceptance criteria, exact file paths, and repo conventions. The orchestrator reviews the resulting diff, stages, and commits.

Before writing implementation code, write the test(s) that pin down the issue's acceptance criteria, and confirm they fail for the right reason — missing behavior, not a typo in the test itself. Follow the `test-driven-development` skill's discipline: red (failing test) → green (minimal implementation in step 8) → refactor. Use the project's existing conventions: Jasmine specs under `app/spec/` (`npm test` / `npm test-window`).

For a bug issue, the failing test should reproduce the reported bug.

No testable code surface (schema files, config, docs, infra)? Then the red→green cycle is the acceptance-criteria command sequence itself — it must fail before the change exists and pass after. Record that adaptation explicitly in `test-cases.md` instead of inventing a meaningless unit test.

For Trivial issues, skip this — go straight from step 6 to step 8.

### 8. Implement with Issue-Referencing Commits

Make **atomic commits** — one logical change per commit.

**Commit format** (no pre-commit hook enforces this in this repo — follow it anyway for a clean, traceable history):
```
<type>(scope): <message> (#N)
```

- `N` = GitHub issue number
- Message: clear, imperative description

**Examples:**
```
fix(account-sidebar): show unread count badge on folder rows (#1)
fix(account-sidebar): add Mark All as Read to folder context menu (#1)
test(account-sidebar): cover unread badge and mark-all-as-read (#1)
```

> For maintenance work without an issue: omit the `(#N)` suffix.

Stage specific files — never `git add -A` or `git add .`.

### 9. Create and Process Test Cases (Real issues only)

After implementing, write concrete test case scenarios covering the issue's acceptance criteria in `docs/issues/N/test-cases.md` — preconditions, steps, expected result — one per distinct behavior or edge case the issue describes. Then process each one: execute it against the running code (the step 7 automated tests already cover some of these; walk through the rest manually, e.g. `npm start` for UI-visible changes) and record pass/fail **with the actual evidence** — command run, relevant output, screenshot reference for UI — in `docs/issues/N/test-results.md`.

Commit both docs with the same commit-message convention as step 8. They ride the PR and become the permanent evidence trail — plus the QA handoff artifact: whoever picks the issue up once it's ready to test gets exact steps to verify instead of re-deriving them from the issue description.

For Trivial issues, skip this — go straight from step 8 to step 10.

### 10. Verify Before Pushing

Verification means running it, not reading the diff and deciding it looks right.

- For a bug issue: confirm the reproduction from step 7 no longer triggers.
- Run the relevant tests (including the ones written in step 7 for Real issues) via `npm test` / `npm test-window`, and confirm they were actually executed, not merely present.
- Run `npm run lint` and `npm run tsc-watch` (single pass) — this repo's `after_edit` hook expects lint-clean TS/JS.
- For Real issues, confirm every test case from step 9 passed, and that `test-results.md` records what was actually executed and its output — verification without recorded evidence doesn't count.
- Check no regressions in related areas.

**Never push without running verification.**

### 11. Gate: Independent Review (Real issues only)

Before pushing, get a cold read on the diff: a fresh subagent that did not write the code reviews it with no summary from the implementer shown first, so its judgment isn't anchored to how the change was justified. This is separate from, and in addition to, the human approval the GitHub PR still requires below — it exists to catch what a human reviewer shouldn't have to spend their review cycle finding.

Same mechanism as Gate: Plan Review — `agent(diffAndInstructions, agent="reviewer", model="anthropic/claude-fable-5")` via `eval`, cold (no summary from the implementer in the prompt). Field note: the `reviewer` agent type carries an output schema the model can violate (schema_violation error) — on that failure, retry with the plain agent (`agent(prompt, model=…)`, no `agent=` arg) and ask for markdown verdict + findings.

Where feedback conflicts with what step 10 verified, re-check against the running code rather than picking a side by assumption.

### 12. Push Branch

```bash
git push -u origin issue-N-brief-slug
```

Repo: `https://github.com/AnsCodeLab/Mailspring`

### 13. Create GitHub PR

```bash
gh pr create --repo AnsCodeLab/Mailspring \
  --base master --head issue-N-brief-slug \
  --title "<issue title>" \
  --body "Refs #N

<brief summary of what changed and why>"
```

**Use `Refs #N`, not `Closes #N`/`Fixes #N`.** GitHub auto-closes the issue the moment a PR using a closing keyword merges — that skips the "never auto-close" discipline in step 15. Link without auto-closing; close explicitly, later, once confirmed.

Enable auto-merge so it lands the moment CI is green and review passes, without needing to poll and merge by hand:
```bash
gh pr merge --repo AnsCodeLab/Mailspring N --auto --squash
```
If the repo doesn't allow auto-merge (branch protection not configured for it), this errors immediately — fall back to the manual merge in step 14 once checks pass and approval is in.

### 14. Wait for CI and Review — Fix Until Green

A PR isn't done at creation. Do not report back or touch issue status until it is actually merged — poll, don't assume auto-merge succeeded silently.

```bash
gh pr checks N --repo AnsCodeLab/Mailspring --watch     # combined CI status, blocks until done
gh pr view N --repo AnsCodeLab/Mailspring --json mergeable,mergeStateStatus,merged,mergedAt,reviews,reviewDecision
```

Loop:
1. CI still running — `gh pr checks N --watch` blocks until it finishes; don't push more commits mid-run.
2. CI failed — read the failing job's logs (`gh run view --log-failed` for the run tied to the head SHA), fix locally, commit with the same convention as step 8, push to the same branch, go back to 1.
3. A review (human or automated, e.g. a bot reviewer configured on the repo) requests changes — read the comments (`gh pr view N --comments`), verify each against the running code before acting (per `receiving-code-review`; don't blindly apply feedback that's technically wrong, but don't dismiss it either). Fix what's warranted, commit, push, go back to 1.
4. Repeat until CI is green, required approval is in, and `merged: true`.

**Bounded wait — don't spin forever.** Two legitimate exits short of `merged: true`:
- CI stuck `pending` well beyond its normal duration (runner queue/outage): stop polling, note the PR URL and state on the issue, tell the user, and resume the loop when CI actually runs.
- CI green but merge blocked on the required human approval: that wait is unbounded by design — post the PR URL on the issue, report to the user, and stop. **Ready-to-test still waits for the merge**; never report closure-readiness while the PR is open.

Step 15's report happens only after `merged: true`; the bounded-wait exits above may post an interim PR-URL comment on the issue without claiming completion.

### 15. Report Back — Never Auto-Close

Add a comment on the issue:
```bash
gh issue comment N --repo AnsCodeLab/Mailspring --body "Implementation complete.
Branch: issue-N-brief-slug
PR: <GitHub PR URL>"
```

For Real issues, reference the evidence docs merged with the PR — `docs/issues/N/plan.md`, `test-cases.md`, `test-results.md` — and paste the test case summary (scenario → pass/fail) into the comment so QA sees it without opening the repo.

For Real issues, append a token cost line to the same comment: sum the token usage of each agent pass (Plan Review, implementor, Independent Review — read it from each pass's result metadata or `history://` transcript), e.g. `~38k tokens across 3 agent passes`. Skip this for Trivial issues. Don't convert to a dollar figure unless this project's rules file defines a current rate — a stale hardcoded price is worse than no price.

Once step 14 confirms the PR is merged, this comment is the ready-to-test signal — reversible, not a closure, so it doesn't need the same explicit user sign-off as closing.

**Never close the issue on your own judgment.** Only the user, after confirming the fix is deployed or explicitly approving closure, closes it (`gh issue close N`) — merging the PR is not that confirmation by itself, which is exactly why step 13 used `Refs #N` instead of a closing keyword.

If the issue's body has a task list linking related issues, leave them untouched unless the user explicitly asked to close them too.

---

## Quick Reference

| Step | Tool / Command |
|------|---------------|
| Fetch issue | `gh issue view N --repo AnsCodeLab/Mailspring --json ...` |
| Claim + mark in progress | `gh issue edit N --add-assignee @me` + comment, not just a note |
| Add comment | `gh issue comment N --body "..."` |
| Plan review (Real issues) | `eval` → `agent(plan, model="anthropic/claude-fable-5")`, plan only, before any code |
| Write tests first (Real issues) | `test-driven-development` — failing test before implementation |
| Implementation (Real issues) | `eval` → `agent(spec, model="anthropic/claude-sonnet-5")` — implementor subagent, steps 7–9 |
| Test cases (Real issues) | Write scenario/steps/expected result, execute, record pass/fail — feeds step 15's QA comment |
| Cost report (Real issues) | Sum token usage per agent pass (result metadata / `history://`), token count only, no invented $ |
| Create branch | `git checkout master && git pull && gh issue develop N --checkout` (or manual `git checkout -b issue-N-slug`) |
| Commit | `git commit -m "type(scope): description (#N)"` |
| Verify | `npm test`, `npm test-window`, `npm run lint` — run it, don't just read the diff |
| Independent review (Real issues) | `eval` → `agent(diff, agent="reviewer", model="anthropic/claude-fable-5")`, cold, before push |
| Push | `git push -u origin issue-N-brief-slug` |
| Create PR | `gh pr create --base master --head issue-N-brief-slug --body "Refs #N ..."` (never `Closes #N`) |
| Auto-merge | `gh pr merge N --auto --squash` |
| CI/review loop | `gh pr checks N --watch` + `gh pr view N --json mergeable,merged,reviews` — fix and repush until `merged: true` |
| Evidence docs (Real issues) | `docs/issues/N/` — plan.md, test-cases.md, test-results.md, committed on the branch |

## Evidence Artifacts (Real issues)

Every Real issue leaves a durable, reviewable trail in the repo, committed on the feature branch so it merges with the PR:

| Doc | Written at | Contains |
|-----|-----------|----------|
| `docs/issues/N/plan.md` | Step 3, verdict appended step 4 | Scope, files touched, approach, open questions, plan-review verdict |
| `docs/issues/N/test-cases.md` | Step 9 | Scenario, preconditions, steps, expected result — per acceptance criterion / edge case |
| `docs/issues/N/test-results.md` | Steps 9–10 | Executed evidence: commands run, output, pass/fail per test case, regression checks |

Trivial issues skip the docs; their report-back comment itself records what was verified.

## Common Mistakes

- **Using `Closes #N`/`Fixes #N` in the PR body** — auto-closes the issue the instant the PR merges, bypassing the "never auto-close" discipline; always use `Refs #N`
- **Branching from wrong base** — always `git checkout master && git pull` first (this repo's default branch is `master`, not `develop`/`main`)
- **Direct merge to master** — always create a GitHub PR, never merge locally
- **Starting without reading the issue** — understand full scope before touching code
- **Large unfocused commits** — one logical change per commit
- **Running both review gates on a one-line config fix** — check Proportionality first; Trivial issues skip both gates
- **Reporting back before the PR actually merged** — auto-merge can still fail CI or reviewer approval; step 14's loop isn't optional
- **Implementing before writing the failing test** — defeats the point of step 7 on a Real issue
- **Skipping both gates on a change that turns out to be architectural** — when unsure, treat it as Real
- **No evidence trail** — a Real issue that merges without `docs/issues/N/` docs can't show what was tested or why the approach was chosen
- **Claiming the issue with only a comment, no assignee** — the assignee field is the actual signal; a text comment alone is easy to miss when scanning the issue list
- **Implementing inline on the orchestrator model** — steps 7–9 belong to the sonnet-5 implementor subagent (see Model roles)
- **Closing the issue without user sign-off** — merging is not that sign-off; only the user closes
