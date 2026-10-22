# Cloudflare fallback scheduler (prepared, not deployed)

The public site and Python parser remain on GitHub Pages / GitHub Actions. This Worker checks the small published `data/heartbeat.json` at :10, :25, :40 and :55 UTC. If the last *successful check* is at least 13 minutes old, or the heartbeat is unavailable, it requests the existing `workflow_dispatch` on `main`. If GitHub's :07/:22/:37/:52 schedule ran on time, the Worker skips dispatch. Both triggers may still occasionally overlap; the GitHub workflow already has a concurrency group.

This is a fallback for missed GitHub `schedule` events, not a promise that GitHub will finish a job exactly 15 minutes later. A successful GitHub dispatch response means the request was accepted, not that Pages was deployed. If the GitHub API rejects a dispatch, the Worker throws so the failure appears in Cloudflare Cron Events / Workers Logs. Keep the GitHub schedule enabled during a 24-hour trial.

## Human setup stages

1. **Cloudflare login (no value stored in this repo).** Install and authorize Wrangler from your own terminal: `npx wrangler login`. Use a Cloudflare account with Workers access.
2. **GitHub credential (secret).** At [GitHub fine-grained tokens](https://github.com/settings/personal-access-tokens/new), create a token restricted to `flattenlol/hkhousing2025` with **Actions: Read and write**, short expiry, and no other repository permissions beyond implicit Metadata. Copy it once. Never put it in the repo, `.env`, chat or a URL.
3. **Deploy and supply the secret.** After this code is pushed and `https://flattenlol.github.io/hkhousing2025/data/heartbeat.json` is live, run the following in your own terminal. Wrangler may first ask to install its npm package; deploy and add the secret consecutively to minimise the time the new Cron exists without a token.

   ```sh
   npx wrangler deploy --config scheduler/wrangler.jsonc
   npx wrangler secret put GITHUB_DISPATCH_TOKEN --config scheduler/wrangler.jsonc
   ```

   The second command requests the token interactively. The `secret put` command deploys a new Worker version. Store the token only as a Cloudflare Worker secret.

4. **Verify without guessing.** Run `node --test tests/test_scheduler.mjs` locally, check the Worker's Cron Events in the Cloudflare dashboard, look for `workflow_dispatch` runs in GitHub Actions, and compare the public heartbeat's `checkedAt` with current time over at least 24 hours. Investigate if it exceeds 30 minutes during selection hours. Rotate the token before expiry; a revoked/expired token stops external dispatches.

No Cloudflare credentials or GitHub personal access token are included in the Worker config. There is no public HTTP handler that can trigger dispatches.

## Sources

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub workflow dispatch REST API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) and [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
