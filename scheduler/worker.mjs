const HEARTBEAT_URL = "https://flattenlol.github.io/hkhousing2025/data/heartbeat.json";
const DISPATCH_URL = "https://api.github.com/repos/flattenlol/hkhousing2025/actions/workflows/publish.yml/dispatches";
const MAX_AGE_MS = 13 * 60_000;

export async function dispatchIfStale(token, fetcher = fetch, now = Date.now()) {
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not configured");

  try {
    const url = new URL(HEARTBEAT_URL);
    url.searchParams.set("check", String(Math.floor(now / 60_000)));
    const response = await fetcher(url.toString(), {
      cache: "no-store", headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const { checkedAt } = await response.json();
      const lastCheck = typeof checkedAt === "string" ? Date.parse(checkedAt) : NaN;
      if (Number.isFinite(lastCheck) && lastCheck <= now && now - lastCheck < MAX_AGE_MS) {
        return false;
      }
    }
  } catch {
    // If the published heartbeat cannot be read, request a check rather than assuming it is fresh.
  }

  const response = await fetcher(DISPATCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "hos2025-status-scheduler",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub workflow dispatch failed (HTTP ${response.status})`);
  return true;
}

export default {
  async scheduled(_controller, env) {
    const dispatched = await dispatchIfStale(env.GITHUB_DISPATCH_TOKEN);
    console.log(dispatched ? "GitHub status check requested" : "Recent status check; dispatch skipped");
  },
};
