import assert from "node:assert/strict";
import test from "node:test";
import { dispatchIfStale } from "../scheduler/worker.mjs";

const now = Date.parse("2026-10-22T10:25:00Z");
const heartbeat = checkedAt => ({ ok: true, json: async () => ({ checkedAt }) });
const accepted = { ok: true, status: 204 };

test("fresh published data skips GitHub dispatch", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return heartbeat("2026-10-22T10:20:00Z");
  };
  assert.equal(await dispatchIfStale("example-token", fetcher, now), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /data\/heartbeat\.json\?check=/);
});

test("stale published data dispatches the existing workflow with a repo-scoped secret", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? heartbeat("2026-10-22T10:00:00Z") : accepted;
  };
  assert.equal(await dispatchIfStale("example-token", fetcher, now), true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /repos\/flattenlol\/hkhousing2025\/actions\/workflows\/publish\.yml\/dispatches$/);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.Authorization, "Bearer example-token");
  assert.deepEqual(JSON.parse(calls[1].options.body), { ref: "main" });
});

test("missing or malformed heartbeat requests a check", async () => {
  for (const first of [{ ok: false, status: 404 }, heartbeat("not a date"),
    heartbeat("2026-10-22T10:26:00Z")]) {
    let calls = 0;
    const fetcher = async () => (++calls === 1 ? first : accepted);
    assert.equal(await dispatchIfStale("example-token", fetcher, now), true);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const fetcher = async () => {
    if (++calls === 1) throw new Error("Network unavailable");
    return accepted;
  };
  assert.equal(await dispatchIfStale("example-token", fetcher, now), true);
  assert.equal(calls, 2);
});

test("missing secret and failed dispatch are visible failures, without logging credentials", async () => {
  await assert.rejects(dispatchIfStale("", async () => accepted, now), /not configured/);
  let calls = 0;
  const fetcher = async () => (++calls === 1 ? heartbeat("2026-10-22T10:00:00Z") : { ok: false, status: 401 });
  await assert.rejects(dispatchIfStale("example-token", fetcher, now), /HTTP 401/);
});
