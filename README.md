# Jira Tools Extension

## Draft-first Jira flow

For create requests, include a title, summary, and short description. Add acceptance criteria when the context is clear enough to make them observable. Use Markdown bullets when the behavior is clear enough to describe that way.

The `jiraGetSprintReview` tool fetches sprint-review data for a Jira board. Pass `boardId` explicitly when you want to inspect a different board, or set `JIRA_BOARD_ID` to use a default board.

For comment requests, use Markdown by default for the comment body, with short paragraphs, bullets, or code blocks when they help. The client exposes helpers for Markdown acceptance criteria and comments if you need to build them programmatically.

## Confirmation

Never call a Jira tool until the user confirms the full draft.

- Example: show the complete draft, then wait for the user to reply `confirm`.
- Example: after confirmation, call `jiraCreateIssue`, `jiraUpdateIssue`, or `jiraAddComment` as needed.

## Tool reference

- `jiraCreateIssue` creates a new issue from `JIRA_PROJECT_KEY` plus `issueType` and `summary`.
- `jiraUpdateIssue` patches the fields the user explicitly asked to change.
- `jiraGetIssue` reads the current issue state before editing it.
- `jiraAddComment` appends a comment to the issue timeline.
- `jiraGetSprintReview` fetches sprint-review data for a project board and uses `JIRA_BOARD_ID` when the caller omits `boardId`.

## Sprint review

`/sprintReview` builds one `SprintReviewDocument`. The CLI summary, the HTML deck (`--html`) and the `jira-sprint-review` session entry all read it, so they always show the same numbers. `n/a` means Jira did not provide a value.

| Section | Contents |
|---|---|
| Goal | Goal status, tickets done / total (+ cancelled), points delivered / committed with the team average, working days left |
| Delivered | Delivered tickets and points, the gap to the team's average completed points, cancelled and done-elsewhere counts |
| Slipped | Remaining points, open tickets split into almost done / in progress / not started, unestimated tickets, scope change, punted tickets |
| Trend | Average completed and committed points over the last closed sprints, reliability, and a per-sprint table |

Counting rules:

- **Parent tickets** (0-point estimate) are not counted: only their child tickets are.
- **Cancelled tickets** (statuses in `JIRA_CANCELLED_STATUSES`) are left out of done, total and points. The goal slide shows them separately, e.g. `4 / 17` with `+1 cancelled`.
- **Almost done** tickets have a status listed in `JIRA_ALMOST_DONE_STATUSES`. **Not started** tickets are in Jira's *To Do* status category; when Jira doesn't report a category (some Server / Data Center sprint reports), their status must be listed in `JIRA_NOT_STARTED_STATUSES`. Status names match ignoring case and extra spaces. Everything else open is **in progress**, so the three buckets always add up to the open tickets.
- **Unestimated** counts open tickets that have no estimate at all.
- **Reliability** is total completed ÷ total committed points over the window, so bigger sprints weigh more.
- **Goal status**: *Achieved* when every counted ticket is done, *Partially achieved* from 50% of points (or of tickets when nothing is estimated), *Missed* below. Individual goals show *Not assessed* until an LLM judges them.
- **Days left** counts working days (Mon–Fri) until the sprint end date. A closed sprint shows `Ended`.

Use `--includeAddedDuringSprint` to count issues added after sprint start in the points. Use `--html` to write the deck to `.pi/sprintReviewReports/Sprint review <end-date>.html`. Use `--pptx` to also write a PowerPoint deck, `Sprint review <end-date>.pptx`: the same slides and numbers as the HTML deck, built from native PowerPoint objects (text, tables and a native column chart), so it stays editable. The LLM summary and goal reasons go into the speaker notes, and long ticket tables continue on extra slides. It uses Arial and Consolas so it lays out the same on machines without the web deck's fonts.

### LLM goal assessment

The points rule above decides the overall goal status. An optional LLM step judges **each goal** and writes a short summary, using the model currently selected in pi (no extra key or configuration). It needs pi 1.0 or later (`@earendil-works/pi-coding-agent`), which lets extensions call models through `modelRegistry.complete()`.

- `/sprintReview --html` and `--pptx` run it by default; add `--no-assess` to skip it.
- `/sprintReview --assess` adds it to the CLI summary; plain `/sprintReview` never calls the model.
- The model receives the goals, the computed facts and each ticket's key, title, type, status, points and stage — no Jira URLs or credentials.
- Ticket titles prefixed with the goal's theme (`[Payments v2][Front] …`) are matched to their goal in code before the call, so the model only judges progress.
- Each verdict cites the tickets it is based on; unknown goals and ticket keys are dropped. If the call fails, the report is produced without it and a warning is shown.
- The result is cached in the pi session and reused until the sprint's tickets or the team rules change.
- In the HTML deck the summary sits on slide 2 above the goal cards, and press **N** to show speaker notes (summary on the cover, goal reasons on slide 2).

Add team context in `.pi/sprint-review-rules.md` (optional): it is sent to the model as `<team_rules>`, e.g. which statuses mean deployed, or how your ticket prefixes map to goals. Start from [`sprint-review-rules.example.md`](sprint-review-rules.example.md). The rules guide the LLM only; counts and points always follow Jira's board columns, so keep the board's last column meaning "delivered".
When the file is used, the footer shows `assessing goals with <model> + team rules…`, the CLI summary is labelled `(<model> · team rules)`, and slide 2 says `with team rules (.pi/sprint-review-rules.md)`.

## Configuration

| Variable | Purpose |
|---|---|
| `JIRA_BASE_URL` | Jira site URL |
| `JIRA_PAT` | Personal access token (Server / Data Center) |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Email and API token (Cloud), used when `JIRA_PAT` is not set |
| `JIRA_PROJECT_KEY`, `JIRA_BOARD_ID` | Defaults for `/sprintReview` |
| `JIRA_CANCELLED_STATUSES` | Comma-separated status names that mean cancelled, e.g. `Cancelled,Won't Do` |
| `JIRA_ALMOST_DONE_STATUSES` | Comma-separated status names that mean almost done, e.g. `To Merge,In Review,To Deploy UAT` |
| `JIRA_NOT_STARTED_STATUSES` | Comma-separated status names that mean not started, used only when Jira gives no status category (default `To Do,To refine,Open,Backlog`) |
| `JIRA_ACCEPTANCE_CRITERIA_FIELD` | Custom field id for acceptance criteria, e.g. `customfield_12345`. When unset, acceptance criteria are appended to the description |

## Usage examples

- `Create a Jira ticket for this bug.`
- `Update PROJ-123 with this summary and description.`
- `Show me PROJ-456 before I change it.`
- `Add a comment to PROJ-789 with the rollout note.`
- `Show me the sprint review for PROJ board 42.`
- `/sprintReview PROJ 42`
- `/sprintReview PROJ --includeAddedDuringSprint` *(includes added issues in the points and reliability)*
- `/sprintReview PROJ` *(uses `JIRA_BOARD_ID` when set)*
- `/sprintReview --html` *(writes the HTML slide deck)*
- `/sprintReview --pptx` *(writes the PowerPoint deck; combine with `--html` for both)*

## Project layout

```
extensions/jira-tools.ts       pi glue only: registers the Jira tools and the /sprintReview command
src/jira/                      Jira API client (auth, HTTP, issues, sprint reports, team velocity) — no pi
src/sprint-review/             sprint review document, CLI text, HTML deck and /sprintReview arguments — no pi, no HTTP
src/sprint-review/templates/   HTML deck template
```

Tests sit next to the file they cover (`*.test.ts`). Run them with `npm test`, and type-check with `npm run typecheck`.

## Troubleshooting

- If PI reports missing credentials, confirm `JIRA_BASE_URL` is set, plus `JIRA_PAT` (Server/Data Center) or `JIRA_EMAIL` and `JIRA_API_TOKEN` (Cloud).
- If Jira rejects the request, verify the issue key or project key format.
- If the extension returns an auth error, confirm the Jira account can create or edit issues in the target project.
