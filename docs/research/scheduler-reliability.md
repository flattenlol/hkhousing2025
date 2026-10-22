# Reliable status-check scheduling (2026-10-22)

## Observed failure

The public dashboard uses a GitHub Actions `schedule` at minutes 07, 22, 37 and 52, plus a `workflow_dispatch` entry point. At 02:34 UTC on 2026-10-22, GitHub reported only one successful scheduled run (23:58 UTC on October 21) since the first push at 20:54 UTC. The published `checkedAt` was 23:58:42 UTC, over 2.5 hours old. The workflow was active; its build and deploy jobs succeeded. This is a missed-freshness problem, not a failing parser.

GitHub explicitly warns that scheduled runs can be delayed and some can be dropped at high load; it offers no 15-minute execution guarantee. It also disables schedules on public repositories after 60 days without activity, which is not the cause here. [GitHub: scheduled events](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Constraints

- Keep GitHub Pages, the existing Python/PyMuPDF ingestion job and the 15-minute browser poll. The browser cannot fetch the official PDFs directly from this origin.
- A successful dispatch only requests a GitHub Actions run. It does not guarantee that GitHub will start or finish the run on time, or that the upstream PDF has changed.
- The public `data/latest.json` `checkedAt` is the freshness signal. The PDF's own modification timestamp describes the upstream publication, not the last successful check.

## Options

| Approach | What changes | Reliability and operational cost |
| --- | --- | --- |
| GitHub schedule alone | Nothing | No new account or secret. GitHub documents delayed/dropped events, matching the observed gap. Manual `workflow_dispatch` remains available. [GitHub schedule](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). |
| Cloudflare Worker Cron -> GitHub dispatch | A small scheduled Worker calls `POST /repos/flattenlol/hkhousing2025/actions/workflows/publish.yml/dispatches` with `{"ref":"main"}`. Python parsing and Pages stay on GitHub. | Independent scheduling source, but not a guaranteed end-to-end 15-minute SLA because GitHub still queues/runs the job. Cloudflare's Cron Trigger has a `scheduled()` handler, uses UTC and can take up to 15 minutes to propagate config changes. [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/); [GitHub dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event). |
| Cloudflare Durable Object alarm -> GitHub dispatch | Stateful self-rescheduling alarm instead of Cron. | Cloudflare documents at-least-once alarm execution and up to six automatic retries when the handler throws, but bootstrapping, self-rescheduling and deduplication add complexity. It still depends on GitHub to run and deploy. SQLite-backed Durable Objects are available on Workers Free. [Alarm guarantees](https://developers.cloudflare.com/durable-objects/api/alarms/); [free-tier pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). |

Cloudflare Workers Free currently lists 100,000 requests/day, 5 Cron Triggers per account and 10 ms CPU per Cron invocation. A single small API dispatch every 15 minutes is 96 scheduled invocations/day; network wait is not CPU time, but actual usage still needs testing. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/); [pricing](https://developers.cloudflare.com/workers/platform/pricing/).

GitHub's dispatch endpoint accepts a fine-grained, repository-scoped token with **Actions: write**. Keep it in a Cloudflare Worker secret, not in `wrangler` variables, repo files or client-side code. Losing or expiring the token stops checks; monitor freshness and rotate it. [GitHub dispatch permission](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event); [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Recommendation (not yet applied)

Trial the Cloudflare Cron dispatch for at least 24 hours while retaining the existing GitHub schedule as a fallback. The workflow's concurrency group already prevents simultaneous executions, although duplicate dispatches can replace a pending run. Monitor published `checkedAt` and the Worker invocation result; alert on >30 minutes without a successful check during selection hours. Once the external trigger proves its cadence, retire the GitHub schedule if redundant. If at-least-once scheduler execution is a hard requirement, consider the more involved Durable Object alarm instead. Cloudflare's Cron history and Workers Logs support investigating missed invocations. [Cloudflare Cron events](https://developers.cloudflare.com/workers/configuration/cron-triggers/); [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/); [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

**Implementation status:** the user has a Cloudflare account. A small fallback Worker and heartbeat are prepared locally; see `scheduler/README.md`. No Worker has been deployed and no token has been created or stored. Confirm the token/Cloudflare setup stages with the user before proceeding.
