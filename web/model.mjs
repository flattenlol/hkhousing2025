export const BLOCK_KEYS = ["kai-yeung-a", "kai-yeung-b", "ying-fai-a", "ying-fai-b"];
export const CATEGORIES = ["small", "medium", "large", "xlarge"];
export const COURT_NAMES = { "kai-yeung": "啟陽苑", "ying-fai": "影輝苑" };

export function planPagesForFlat(key, floor) {
  const plans = {
    "kai-yeung-a": { from: 2, to: 40, pages: [5, 6] },
    "kai-yeung-b": { from: 2, to: 40, pages: [7, 8] },
    "ying-fai-a": { from: 3, to: 39, pages: [5] },
    "ying-fai-b": { from: 4, to: 38, pages: [6] },
  };
  const plan = plans[key];
  return plan && floor >= plan.from && floor <= plan.to ? plan.pages : [];
}

export function countAvailable(snapshot, categories) {
  const counts = { "kai-yeung": 0, "ying-fai": 0 };
  for (const block of Object.values(snapshot.blocks)) {
    counts[block.court] += block.flats.filter(flat => flat.s === "available" && categories.has(flat.a)).length;
  }
  return counts;
}

export function availableByCategory(snapshot) {
  const counts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  for (const block of Object.values(snapshot.blocks)) {
    for (const flat of block.flats) {
      if (flat.s === "available" && flat.a in counts) counts[flat.a]++;
    }
  }
  return counts;
}

export function quotaHourDelta(snapshot, history) {
  const checkedAt = Date.parse(snapshot.checkedAt);
  const target = Date.parse(snapshot.checkedAt) - 60 * 60 * 1000;
  if (Date.parse(history.startedAt) > target) return null;
  const firstChangeSince = history.events.find(event => {
    const at = Date.parse(event.at);
    return at > target && at <= checkedAt;
  });
  const baseline = firstChangeSince?.beforeQuota.courts ?? snapshot.quota.courts;
  return Object.fromEntries(
    Object.entries(snapshot.quota.courts).map(([key, court]) => [key, court.remaining - baseline[key].remaining])
  );
}

export function snapshotAt(latest, history, index) {
  if (index === "latest") return latest;
  const snapshot = structuredClone(latest);
  for (let i = history.events.length - 1; i > index; i--) {
    const event = history.events[i];
    snapshot.quota = event.beforeQuota;
    for (const [key, change] of Object.entries(event.blocks)) {
      const block = snapshot.blocks[key];
      block.modifiedAt = change.beforeModified;
      block.remaining = change.beforeRemaining;
      if (change.beforeBands) block.bands = change.beforeBands;
      const old = new Map(change.flats.map(flat => [flat.n, flat.before]));
      block.flats = block.flats.map(flat => old.get(flat.n) ?? flat);
    }
  }
  snapshot.checkedAt = index === -1 ? history.startedAt : history.events[index].at;
  return snapshot;
}

function statusChanges(event) {
  const flats = [];
  for (const [key, block] of Object.entries(event.blocks)) {
    if (block.beforeModified === block.afterModified) continue;
    for (const change of block.flats) {
      if (change.before.s !== change.after.s) flats.push({ key, ...change });
    }
  }
  return flats;
}

export function lastStatusChange(history, selected = "latest") {
  if (selected === -1) return null;
  const lastIndex = selected === "latest" ? history.events.length - 1 : selected;
  for (let i = lastIndex; i >= 0; i--) {
    const event = history.events[i];
    const flats = statusChanges(event);
    if (flats.length) return { event, flats };
    if (selected !== "latest") break;
  }
  return null;
}

export function recentChanges(history, selected = "latest") {
  const change = lastStatusChange(history, selected);
  return new Set(change?.flats.map(flat => `${flat.key}-${flat.n}`) ?? []);
}

export function parsePreferences(text) {
  const ranks = new Map();
  const lastRank = { "kai-yeung": 0, "ying-fai": 0 };
  for (const line of text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    const match = /^(啟陽苑?|影輝苑?|kai-yeung|ying-fai)\s*([AB])\s*[:：]\s*(.+)$/i.exec(line);
    if (!match) throw new Error(`無法辨認這一行：${line}`);
    const court = /^(啟|kai)/i.test(match[1]) ? "kai-yeung" : "ying-fai";
    const key = `${court}-${match[2].toLowerCase()}`;
    const order = match[3].replace(/\s+/g, "");
    if (!/^\d{1,2}(?:[>=]\d{1,2})*$/.test(order)) throw new Error(`請使用「室號 > 室號 = 室號」：${line}`);
    const tokens = order.split(/([>=])/);
    let rank = lastRank[court] + 1;
    for (let i = 0; i < tokens.length; i += 2) {
      if (i && tokens[i - 1] === ">") rank++;
      const unit = Number(tokens[i]);
      if (unit < 1 || unit > (key === "kai-yeung-a" ? 17 : key === "kai-yeung-b" ? 29 : 22)) {
        throw new Error(`室號超出該座範圍：${line}`);
      }
      const id = `${key}-${unit}`;
      if (ranks.has(id)) throw new Error(`室號重複：${line}`);
      ranks.set(id, rank);
    }
    lastRank[court] = rank;
  }
  return ranks;
}

export function parseAvoidFloors(text) {
  const floors = new Set();
  if (!text.trim()) return floors;
  for (const token of text.split(/[,，、]/).map(value => value.trim())) {
    const match = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(token);
    if (!match || +(match[2] ?? match[1]) > 50 || +match[1] < 1 || +(match[2] ?? match[1]) < +match[1]) {
      throw new Error(`樓層範圍格式不正確：${token}`);
    }
    for (let floor = +match[1]; floor <= +(match[2] ?? match[1]); floor++) floors.add(floor);
  }
  return floors;
}

const SHARE_FIELDS = {
  courtFirst: "prefCourt",
  floorMin: "prefFloor",
  avoidKai: "prefAvoidKai",
  avoidYing: "prefAvoidYing",
  rankings: "prefRanks",
};

function validateSharedPreferences(profile) {
  if (!["", "kai-yeung", "ying-fai"].includes(profile.courtFirst ?? "")) {
    throw new Error("分享連結的優先屋苑無效");
  }
  const floor = profile.floorMin ?? "";
  if (floor !== "" && (!/^\d{1,2}$/.test(floor) || +floor < 1 || +floor > 50)) {
    throw new Error("分享連結的偏好樓層無效");
  }
  for (const value of [profile.avoidKai ?? "", profile.avoidYing ?? ""]) {
    if (value.length > 150) throw new Error("較不偏好樓層內容過長");
    parseAvoidFloors(value);
  }
  if ((profile.rankings ?? "").length > 3000) throw new Error("單位喜好排序內容過長");
  parsePreferences(profile.rankings ?? "");
}

export function createPreferenceUrl(href, profile, categories) {
  validateSharedPreferences(profile);
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  for (const [field, param] of Object.entries(SHARE_FIELDS)) {
    url.searchParams.set(param, profile[field] ?? "");
  }
  url.searchParams.set("prefSizes", CATEGORIES.filter(category => categories.has(category)).join(","));
  return url.toString();
}

export function readPreferenceUrl(href) {
  const params = new URL(href).searchParams;
  if (![...Object.values(SHARE_FIELDS), "prefSizes"].some(param => params.has(param))) return null;
  const profile = Object.fromEntries(
    Object.entries(SHARE_FIELDS).filter(([, param]) => params.has(param))
      .map(([field, param]) => [field, params.get(param)])
  );
  validateSharedPreferences(profile);
  let categories = null;
  if (params.has("prefSizes")) {
    const names = params.get("prefSizes");
    const selected = names ? names.split(",") : [];
    if (selected.some(name => !CATEGORIES.includes(name))) throw new Error("分享連結的面積類別無效");
    categories = new Set(selected);
  }
  return { profile, categories };
}

export function shortlist(snapshot, history, profile, categories) {
  const ranks = parsePreferences(profile.rankings ?? "");
  const preferredFloor = Number(profile.floorMin) || 1;
  const cutoff = Date.parse(snapshot.checkedAt) - 24 * 60 * 60 * 1000;
  const enoughHistory = Date.parse(snapshot.checkedAt) - Date.parse(history.startedAt) >= 60 * 60 * 1000;
  const picks = [];
  for (const [id, rank] of ranks) {
    const key = id.slice(0, id.lastIndexOf("-"));
    const court = snapshot.blocks[key].court;
    if (snapshot.quota.courts[court]?.remaining <= 0) continue;
    const unit = +id.slice(id.lastIndexOf("-") + 1);
    const avoid = parseAvoidFloors(court === "kai-yeung" ? profile.avoidKai ?? "" : profile.avoidYing ?? "");
    const options = snapshot.blocks[key].flats
      .filter(flat => flat.u === unit && flat.s === "available" && categories.has(flat.a))
      .sort((a, b) =>
        (avoid.has(a.f) - avoid.has(b.f))
        || ((b.f >= preferredFloor) - (a.f >= preferredFloor))
        || b.f - a.f
      );
    if (!options.length) continue;
    const lost = history.events
      .filter(event => Date.parse(event.at) >= cutoff)
      .flatMap(event => event.blocks[key]?.flats ?? [])
      .filter(change => change.before.u === unit && change.before.s === "available" && change.after.s !== "available")
      .length;
    picks.push({ key, court, unit, rank, flat: options[0], count: options.length, lost,
      enoughHistory, preferred: options[0].f >= preferredFloor, avoided: avoid.has(options[0].f) });
  }
  return picks.sort((a, b) =>
    ((a.court !== profile.courtFirst) - (b.court !== profile.courtFirst))
    || (a.avoided - b.avoided)
    || (b.preferred - a.preferred)
    || (a.rank - b.rank)
    || (b.count - a.count)
  );
}
