import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCheckingWindow, shouldWarnStale } from "../web/schedule.mjs";

function expandCron(expressions) {
  const values = field => {
    const [start, end = start] = field.split("-").map(Number);
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  };
  return expressions.flatMap(expression => {
    const [minute, hour] = expression.split(" ");
    return values(hour).flatMap(h => values(minute).map(m => ((h + 8) % 24) * 60 + m));
  }).sort((a, b) => a - b);
}

test("GitHub schedule covers 09:30 through 22:00 HKT at exactly 30-minute intervals", () => {
  const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  const crons = [...workflow.matchAll(/- cron: "([^"]+)"/g)].map(match => match[1]);
  const slots = expandCron(crons);
  assert.equal(slots.length, 26);
  assert.equal(slots[0], 9 * 60 + 30);
  assert.equal(slots.at(-1), 22 * 60);
  assert.ok(slots.slice(1).every((slot, index) => slot - slots[index] === 30));
});

test("Cloudflare fallback is staggered inside the window without overnight triggers", () => {
  const config = JSON.parse(readFileSync(new URL("../scheduler/wrangler.jsonc", import.meta.url), "utf8"));
  const slots = expandCron(config.triggers.crons);
  assert.equal(slots.length, 25);
  assert.equal(slots[0], 9 * 60 + 33);
  assert.equal(slots.at(-1), 21 * 60 + 33);
  assert.ok(slots.slice(1).every((slot, index) => slot - slots[index] === 30));
});

test("browser window and stale warning follow Hong Kong time, not browser timezone", () => {
  const at = text => Date.parse(text);
  assert.equal(isCheckingWindow(at("2026-10-22T01:29:00Z")), false);
  assert.equal(isCheckingWindow(at("2026-10-22T01:30:00Z")), true);
  assert.equal(isCheckingWindow(at("2026-10-22T14:00:00Z")), true);
  assert.equal(isCheckingWindow(at("2026-10-22T14:01:00Z")), false);
  assert.equal(shouldWarnStale("2026-10-21T14:00:00Z", at("2026-10-22T01:44:00Z")), false);
  assert.equal(shouldWarnStale("2026-10-21T14:00:00Z", at("2026-10-22T01:45:00Z")), true);
  assert.equal(shouldWarnStale("2026-10-22T01:30:00Z", at("2026-10-22T02:00:00Z")), false);
  assert.equal(shouldWarnStale("2026-10-22T12:00:00Z", at("2026-10-22T14:01:00Z")), false);
});
