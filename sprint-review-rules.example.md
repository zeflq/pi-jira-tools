# Sprint review rules (example)

<!--
Copy this file to `.pi/sprint-review-rules.md` in the project where you run pi, then edit it for your team.
Its text is sent to the LLM as <team_rules> when `/sprintReview` assesses the sprint goals.
It only guides the LLM's per-goal verdicts and summary: ticket counts, points and the overall status
always come from Jira. Editing this file makes the next run re-assess instead of reusing the cached result.
Keep it short and factual, one rule per line.
-->

## Delivery

- A ticket counts as delivered only once deployed in PROD.

## Ticket themes

- Every ticket title starts with the goal's theme in brackets, e.g. `[Payments v2][Front] …` belongs to the goal "Ship Payments-V2".
- A second bracket like `[Front]` or `[Back]` is the area, not a goal.

## Workflow statuses

- "To Merge" and "To Review": code is written, waiting for review or merge.
- "To deploy in UAT": merged, not yet deployed anywhere.
- "Done": deployed in PROD.
