import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCK_KEYS, availableByCategory, countAvailable, createPreferenceUrl, parseAvoidFloors,
  parsePreferences, planPagesForFlat, quotaHourDelta, readPreferenceUrl,
  recentChanges, shortlist, snapshotAt,
} from "../web/model.mjs";

test("updated brochure maps floor plans to the right Ying Fai B floors and court tabs to A then B", () => {
  assert.deepEqual(BLOCK_KEYS, ["kai-yeung-a", "kai-yeung-b", "ying-fai-a", "ying-fai-b"]);
  assert.deepEqual(planPagesForFlat("ying-fai-b", 3), []);
  assert.deepEqual(planPagesForFlat("ying-fai-b", 4), [6]);
  assert.deepEqual(planPagesForFlat("ying-fai-b", 38), [6]);
  assert.deepEqual(planPagesForFlat("ying-fai-b", 39), []);
  assert.deepEqual(planPagesForFlat("ying-fai-a", 39), [5]);
  assert.deepEqual(planPagesForFlat("ying-fai-a", 40), []);
});

const starting = {
  checkedAt: "2026-10-21T12:00:00Z",
  quota: { modifiedAt: "2026-10-21 20:00", courts: {
    "kai-yeung": { remaining: 330 }, "ying-fai": { remaining: 560 },
  } },
  blocks: {
    "kai-yeung-b": { court: "kai-yeung", modifiedAt: "2026-10-21 20:00", remaining: 2,
      bands: { medium: { min: 34.8, max: 36.5 } }, flats: [
      { n: 4011, f: 40, u: 11, s: "available", a: "medium" },
      { n: 1211, f: 12, u: 11, s: "available", a: "medium" },
      { n: 4012, f: 40, u: 12, s: "sold", a: null },
    ] },
    "ying-fai-a": { court: "ying-fai", modifiedAt: "2026-10-21 20:00", remaining: 1, flats: [
      { n: 3913, f: 39, u: 13, s: "available", a: "large" },
    ] },
  },
};

test("quota remains separate from selectable flat counts and requires an hour of history", () => {
  assert.deepEqual(countAvailable(starting, new Set(["medium"])), { "kai-yeung": 2, "ying-fai": 0 });
  assert.equal(quotaHourDelta(starting, { startedAt: "2026-10-21T11:01:00Z", events: [] }), null);
  assert.deepEqual(quotaHourDelta(starting, { startedAt: "2026-10-21T11:00:00Z", events: [] }), { "kai-yeung": 0, "ying-fai": 0 });
  const previous = structuredClone(starting.quota);
  previous.courts["kai-yeung"].remaining = 332;
  const history = { startedAt: "2026-10-21T10:00:00Z", events: [
    { at: "2026-10-21T11:20:00Z", beforeQuota: previous, afterQuota: starting.quota },
  ] };
  assert.deepEqual(quotaHourDelta(starting, history), { "kai-yeung": -2, "ying-fai": 0 });
  const historical = structuredClone(starting);
  historical.checkedAt = "2026-10-21T11:10:00Z";
  historical.quota = previous;
  assert.deepEqual(quotaHourDelta(historical, history), { "kai-yeung": 0, "ying-fai": 0 });
});

test("filter badges count available flats by size across both courts, including unselected sizes", () => {
  assert.deepEqual(availableByCategory(starting), { small: 0, medium: 2, large: 1, xlarge: 0 });
  const updated = structuredClone(starting);
  updated.blocks["kai-yeung-b"].flats[0].s = "sold";
  assert.deepEqual(availableByCategory(updated), { small: 0, medium: 1, large: 1, xlarge: 0 });
});

test("rank ties and line order are preserved, and floor avoidance is a range", () => {
  const ranks = parsePreferences("啟陽 B: 19 > 20 = 21\n啟陽 B: 24\n影輝 A: 11=12");
  assert.equal(ranks.get("kai-yeung-b-19"), 1);
  assert.equal(ranks.get("kai-yeung-b-20"), 2);
  assert.equal(ranks.get("kai-yeung-b-21"), 2);
  assert.equal(ranks.get("kai-yeung-b-24"), 3);
  assert.equal(ranks.get("ying-fai-a-11"), 1);
  assert.deepEqual([...parseAvoidFloors("5-7, 9")], [5, 6, 7, 9]);
  assert.throws(() => parsePreferences("啟陽 B: 19 > 19"), /重複/);
});

test("a mixed range and single avoided floor both lower the matching stack options", () => {
  const history = { startedAt: starting.checkedAt, events: [], samples: [] };
  const picks = shortlist(starting, history, {
    courtFirst: "kai-yeung", floorMin: "20", avoidKai: "8-10, 40",
    rankings: "啟陽 B: 11",
  }, new Set(["medium"]));
  assert.equal(picks[0].flat.f, 12);
  assert.equal(picks[0].count, 2);
});

test("shared URL round-trips preferences and filters without exposing applicant details", () => {
  const profile = {
    code: "GP000999", selectionAt: "2030-01-01T10:30",
    courtFirst: "kai-yeung", floorMin: "15", avoidKai: "8-10, 32",
    avoidYing: "5", rankings: "啟陽 A: 1 > 2\n影輝 B: 15 = 16",
  };
  const link = createPreferenceUrl(
    "https://example.org/hos/dashboard/?token=do-not-forward#profile",
    profile, new Set(["medium", "large"]),
  );
  assert.equal(link.startsWith("https://example.org/hos/dashboard/?prefCourt="), true);
  for (const sensitive of [profile.code, "selectionAt", profile.selectionAt, "token", "#profile"]) {
    assert.equal(link.includes(sensitive), false);
  }
  assert.deepEqual(readPreferenceUrl(link), {
    profile: {
      courtFirst: profile.courtFirst, floorMin: profile.floorMin,
      avoidKai: profile.avoidKai, avoidYing: profile.avoidYing, rankings: profile.rankings,
    },
    categories: new Set(["medium", "large"]),
  });
  assert.equal(readPreferenceUrl("https://example.org/hos/dashboard/"), null);
  assert.throws(() => readPreferenceUrl("https://example.org/?prefFloor=99"), /偏好樓層/);
});

test("historical versions undo only later changes; flashes require a new PDF timestamp", () => {
  const latest = structuredClone(starting);
  latest.checkedAt = "2026-10-21T14:00:00Z";
  latest.blocks["kai-yeung-b"].flats[0].s = "sold";
  latest.blocks["kai-yeung-b"].flats[0].a = null;
  latest.blocks["kai-yeung-b"].remaining = 1;
  latest.blocks["kai-yeung-b"].bands.medium.max = 37.0;
  const previous = starting.blocks["kai-yeung-b"].flats[0];
  const after = latest.blocks["kai-yeung-b"].flats[0];
  const change = { n: 4011, before: previous, after };
  const event = {
    at: latest.checkedAt, beforeQuota: starting.quota, afterQuota: latest.quota,
    blocks: { "kai-yeung-b": {
      beforeModified: "2026-10-21 20:00", afterModified: "2026-10-21 22:00",
      beforeRemaining: 2, afterRemaining: 1, flats: [change],
      beforeBands: starting.blocks["kai-yeung-b"].bands,
      afterBands: latest.blocks["kai-yeung-b"].bands,
    } },
  };
  const history = { startedAt: starting.checkedAt, events: [event], samples: [] };
  assert.equal(snapshotAt(latest, history, -1).blocks["kai-yeung-b"].flats[0].s, "available");
  assert.equal(snapshotAt(latest, history, -1).blocks["kai-yeung-b"].bands.medium.max, 36.5);
  assert.deepEqual([...recentChanges(history)], ["kai-yeung-b-4011"]);
  event.blocks["kai-yeung-b"].afterModified = "2026-10-21 20:00";
  assert.equal(recentChanges(history).size, 0);
});

test("shortlist applies court preference and downranks avoided floors without hiding them", () => {
  const history = { startedAt: "2026-10-21T09:00:00Z", events: [], samples: [] };
  const picks = shortlist(starting, history, {
    courtFirst: "kai-yeung", floorMin: "20", avoidKai: "12-14", avoidYing: "",
    rankings: "啟陽 B: 11\n影輝 A: 13",
  }, new Set(["medium", "large"]));
  assert.equal(picks.length, 2);
  assert.equal(picks[0].key, "kai-yeung-b");
  assert.equal(picks[0].flat.n, 4011);
  assert.equal(picks[0].count, 2);
  const noQuota = structuredClone(starting);
  noQuota.quota.courts["kai-yeung"].remaining = 0;
  assert.deepEqual(shortlist(noQuota, history, {
    courtFirst: "kai-yeung", rankings: "啟陽 B: 11\n影輝 A: 13",
  }, new Set(["medium", "large"])).map(pick => pick.court), ["ying-fai"]);
});
