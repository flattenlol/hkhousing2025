import {
  BLOCK_KEYS, CATEGORIES, COURT_NAMES, availableByCategory, countAvailable,
  createPreferenceUrl, parseAvoidFloors, parsePreferences, planPagesForFlat,
  quotaHourDelta, readPreferenceUrl, recentChanges, shortlist, snapshotAt,
} from "./model.mjs";

const PDF_BASE = "https://www.housingauthority.gov.hk/mini-site/hos2025/common/pdf/status/";
const LABELS = { small: "小型", medium: "中型", large: "大型", xlarge: "特大型" };
const COLORS = {
  "kai-yeung": { small: "#8ab66e", medium: "#4e7835", large: "#143f00" },
  "ying-fai": { small: "#ffe4ca", medium: "#ffbb77", large: "#d26900", xlarge: "#844200" },
};
const NAMES = {
  "kai-yeung-a": "啟陽苑 A座", "kai-yeung-b": "啟陽苑 B座",
  "ying-fai-a": "影輝苑 A座", "ying-fai-b": "影輝苑 B座",
};
const $ = id => document.getElementById(id);
function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const state = {
  latest: null, history: null, activeBlock: "kai-yeung-a",
  chosen: "latest", categories: new Set(CATEGORIES), profile: {},
  lastRefresh: Number(readLocal("hos-last-manual-refresh")) || 0,
};

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function officialTime(value) {
  return value ? `${value.replace(" ", "　")} HKT` : "—";
}

function current() {
  return snapshotAt(state.latest, state.history, state.chosen);
}

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

function loadProfile() {
  try { state.profile = JSON.parse(readLocal("hos-private-profile") || "{}"); }
  catch { state.profile = {}; }
  try {
    const shared = readPreferenceUrl(window.location.href);
    if (shared) {
      state.profile = { ...state.profile, ...shared.profile };
      if (shared.categories !== null) state.categories = shared.categories;
      $("profile-message").textContent = "已從連結載入喜好；按「儲存」先會保留於此瀏覽器";
    } else if (state.profile.code || state.profile.rankings) {
      $("profile-message").textContent = "已從此瀏覽器載入私人設定";
    }
  } catch (error) {
    $("profile-message").textContent = `分享連結無效：${error.message}`;
  }
  const profile = state.profile;
  $("applicant-code").value = profile.code || "";
  $("selection-at").value = profile.selectionAt || "";
  $("court-first").value = profile.courtFirst || "";
  $("floor-min").value = profile.floorMin || "";
  $("avoid-kai").value = profile.avoidKai || "";
  $("avoid-ying").value = profile.avoidYing || "";
  $("rankings").value = profile.rankings || "";
}

function profileFromForm() {
  return {
    code: $("applicant-code").value.trim().toUpperCase(),
    selectionAt: $("selection-at").value,
    courtFirst: $("court-first").value,
    floorMin: $("floor-min").value,
    avoidKai: $("avoid-kai").value.trim(),
    avoidYing: $("avoid-ying").value.trim(),
    rankings: $("rankings").value.trim(),
  };
}

function saveProfile(event) {
  event.preventDefault();
  try {
    const profile = profileFromForm();
    if (profile.code && !/^[A-Z]{2}\d{6}$/.test(profile.code)) throw new Error("選樓編號格式應為 GP000123 等兩個英文字母加六位數字。");
    if (profile.floorMin && (+profile.floorMin < 1 || +profile.floorMin > 50)) throw new Error("偏好樓層請填 1 至 50。");
    parsePreferences(profile.rankings);
    parseAvoidFloors(profile.avoidKai);
    parseAvoidFloors(profile.avoidYing);
    localStorage.setItem("hos-private-profile", JSON.stringify(profile));
    state.profile = profile;
    $("profile-message").textContent = "已儲存在此瀏覽器";
    if (state.latest) render();
  } catch (error) {
    $("profile-message").textContent = error.message;
  }
}

async function sharePreferences() {
  let link;
  try {
    link = createPreferenceUrl(window.location.href, profileFromForm(), state.categories);
  } catch (error) {
    $("profile-message").textContent = `未能產生連結：${error.message}`;
    return;
  }
  $("share-url").value = link;
  $("share-panel").hidden = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("瀏覽器未提供剪貼簿功能");
    await navigator.clipboard.writeText(link);
    $("profile-message").textContent = "喜好連結已複製；不含選樓編號及時段";
  } catch {
    $("profile-message").textContent = "無法自動複製；可從下方手動複製連結";
  }
}

async function loadData() {
  try {
    const nonce = Date.now();
    const [latest, history] = await Promise.all([
      fetch(`./data/latest.json?v=${nonce}`, { cache: "no-store" }).then(response => {
        if (!response.ok) throw new Error("無法取得最新資料"); return response.json();
      }),
      fetch(`./data/history.json?v=${nonce}`, { cache: "no-store" }).then(response => {
        if (!response.ok) throw new Error("無法取得歷史資料"); return response.json();
      }),
    ]);
    if (!latest.blocks || !Array.isArray(history.events) || !history.startedAt) throw new Error("資料格式不完整");
    state.latest = latest;
    state.history = history;
    $("error").hidden = true;
    $("checked-time").textContent = `資料擷取 ${formatTime(latest.checkedAt)} HKT`;
    if (Date.now() - Date.parse(latest.checkedAt) > 45 * 60_000) {
      showError("已發布資料超過 45 分鐘未完成新檢查，可能不是最新狀態。請查看官方 PDF。");
    }
    updateHistoryOptions();
    render();
  } catch (error) {
    showError(`目前無法讀取已發布資料：${error.message}。請稍後重試，或查看官方 PDF。`);
  }
}

function updateHistoryOptions() {
  const select = $("history-select");
  const old = state.chosen;
  select.replaceChildren(new Option("最新資料", "latest"));
  state.history.events.forEach((event, index) => {
    select.add(new Option(`${formatTime(event.at)} 更新`, String(index)));
  });
  if (Date.parse(state.history.startedAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000) {
    select.add(new Option(`${formatTime(state.history.startedAt)} 首次記錄`, "-1"));
  }
  if (old !== "latest" && ![...select.options].some(option => option.value === String(old))) state.chosen = "latest";
  select.value = String(state.chosen);
}

function renderQuotas(snapshot) {
  const deltas = quotaHourDelta(snapshot, state.history);
  $("quota-cards").innerHTML = Object.entries(snapshot.quota.courts).map(([key, value]) => {
    const delta = deltas?.[key];
    const deltaText = delta == null ? "資料不足" : `${delta > 0 ? "+" : ""}${delta} / 過去一小時`;
    return `<article class="quota-card">
      <div class="quota-card-head"><h3>${value.name}</h3><span>優先計劃 · 全苑</span></div>
      <div class="quota-number">${value.remaining.toLocaleString("zh-HK")}</div>
      <div class="quota-card-bottom"><span>原有 ${value.total.toLocaleString("zh-HK")} 個單位</span>
        <span class="quota-delta ${delta > 0 ? "up" : ""}">${deltaText}</span></div>
      <div class="quota-meter" role="img" aria-label="配額佔原有單位數的比例">
        <b style="width:${Math.min(100, value.remaining / value.total * 100)}%"></b></div>
    </article>`;
  }).join("");
  $("quota-modified").textContent = `官方配額更新：${officialTime(snapshot.quota.modifiedAt)}`;
  $("delta-note").textContent = deltas ? "與一小時前最近已知的配額比較" : "一小時前未有可靠記錄，不顯示推算";
}

function renderFilters(snapshot) {
  const counts = availableByCategory(snapshot);
  $("category-filters").innerHTML = CATEGORIES.map(category => {
    const color = COLORS["ying-fai"][category];
    return `<button type="button" class="filter-chip" data-category="${category}"
      aria-pressed="${state.categories.has(category)}"><span class="swatch" style="--swatch:${color}"></span>
      ${LABELS[category]} <small aria-label="四座尚餘 ${counts[category]} 間">${counts[category].toLocaleString("zh-HK")}</small></button>`;
  }).join("");
}

function renderCourtSummary(snapshot) {
  const counts = countAvailable(snapshot, state.categories);
  $("court-summary").innerHTML = Object.entries(counts).map(([court, count]) => {
    const flats = Object.values(snapshot.blocks).filter(block => block.court === court)
      .flatMap(block => block.flats).filter(flat => flat.s === "available");
    const breakdown = CATEGORIES.map(category => {
      const amount = flats.filter(flat => flat.a === category).length;
      return amount ? `<span class="${state.categories.has(category) ? "" : "muted"}">${LABELS[category]} ${amount}</span>` : "";
    }).join("");
    return `<div class="court-stat"><div><strong>${COURT_NAMES[court]}</strong><small>所選類別 · A / B 座未售</small>
      <div class="court-breakdown">${breakdown}</div></div><b>${count.toLocaleString("zh-HK")}</b></div>`;
  }).join("");
}

function renderTabs() {
  $("block-tabs").innerHTML = BLOCK_KEYS.map(key => `<button type="button" class="block-tab"
    role="tab" data-block="${key}" aria-selected="${state.activeBlock === key}">${NAMES[key]}</button>`).join("");
}

function areaText(band) {
  if (!band) return "原 PDF 沒有標示該狀態的面積類別";
  const low = band.min;
  const high = band.max;
  return `${low}${low === high ? "" : `–${high}`} 平方米`;
}

function renderMatrix(snapshot) {
  const key = state.activeBlock;
  const block = snapshot.blocks[key];
  const isKai = block.court === "kai-yeung";
  const maxUnit = isKai ? (block.block === "A" ? 17 : 29) : 22;
  const floors = [...new Set(block.flats.map(flat => flat.f))].sort((a, b) => b - a);
  const flats = new Map(block.flats.map(flat => [`${flat.f}-${flat.u}`, flat]));
  const changed = state.chosen === "latest" && Date.now() - Date.parse(state.history.events.at(-1)?.at || 0) < 30 * 60 * 1000
    ? recentChanges(state.history) : new Set();
  const filteredCount = block.flats.filter(flat => flat.s === "available" && state.categories.has(flat.a)).length;
  $("matrix-title").textContent = `${NAMES[key]} · 所選類別尚餘 ${filteredCount} 間`;
  $("matrix-meta").textContent = `全座未售 ${block.remaining} 間 ｜ 官方 PDF：${officialTime(block.modifiedAt)} ｜ 橫向排列與原表格一致`;
  $("block-source").href = `${PDF_BASE}status-${key}.pdf`;
  $("legend").innerHTML = [
    ...Object.entries(block.bands).map(([category, band]) =>
      `<span class="legend-item"><i class="legend-swatch" style="--shade:${COLORS[block.court][category]}"></i>
      ${LABELS[category]} ${areaText(band)}</span>`),
    '<span class="legend-item"><i class="legend-swatch sold"></i>已售</span>',
    '<span class="legend-item"><i class="legend-swatch selected"></i>已選</span>',
    '<span class="legend-item"><i class="legend-swatch match"></i>偏好室號</span>',
  ].join("");
  let ranks = new Map();
  try { ranks = parsePreferences(state.profile.rankings || ""); } catch { /* Invalid drafts are not saved. */ }
  const cells = ['<div class="matrix-cell floor-heading column-heading">樓層</div>'];
  for (let unit = 1; unit <= maxUnit; unit++) cells.push(`<div class="matrix-cell column-heading">${unit}</div>`);
  for (const floor of floors) {
    cells.push(`<div class="matrix-cell floor-heading">${floor}/F</div>`);
    for (let unit = 1; unit <= maxUnit; unit++) {
      const flat = flats.get(`${floor}-${unit}`);
      if (!flat) { cells.push('<div class="matrix-cell" aria-hidden="true"></div>'); continue; }
      const inFilter = flat.s !== "available" || state.categories.has(flat.a);
      const match = ranks.has(`${key}-${unit}`) && flat.s === "available";
      const flash = changed.has(`${key}-${flat.n}`);
      const color = flat.s === "available" ? COLORS[block.court][flat.a] : "#fff";
      const darkText = flat.a === "small" || (block.court === "ying-fai" && flat.a === "medium");
      cells.push(`<button type="button" class="matrix-cell flat-cell ${flat.s}
        ${inFilter ? "" : "filtered-out"} ${match ? "match" : ""} ${flash ? "recent-change" : ""}"
        style="--shade:${color};--cell-text:${darkText ? "#21342c" : "#fff"}"
        data-flat="${flat.n}" aria-label="${NAMES[key]} ${floor}樓 ${unit}室 ${flat.s === "available" ? "未售" : flat.s === "sold" ? "已售" : "已選"}"
        title="${floor}樓 ${unit}室"><span class="flat-inner"><span>${unit}</span></span></button>`);
    }
  }
  const matrix = $("matrix");
  matrix.style.gridTemplateColumns = `59px repeat(${maxUnit}, 39px)`;
  matrix.innerHTML = cells.join("");
}

function renderShortlist(snapshot) {
  const target = $("shortlist-content");
  let picks;
  try { picks = shortlist(snapshot, state.history, state.profile, state.categories); }
  catch { picks = []; }
  if (!picks.length) {
    target.innerHTML = `<p class="empty-state">${state.profile.rankings
      ? "目前的面積篩選沒有符合喜好而仍可選的單位；試試其他類別，或查看完整單位表。"
      : "先填寫上方喜好排序，便可以將仍然可選的心水單位放到這裡。"}</p>`;
    return;
  }
  target.innerHTML = picks.slice(0, 12).map((pick, index) => {
    const risk = !pick.enoughHistory ? "歷史資料不足，暫不推測出售速度"
      : pick.lost >= 2 ? `近 24 小時此室號有 ${pick.lost} 間轉為已選／已售`
      : pick.count >= 5 ? "現時仍有多個樓層可選；非購買保證" : "可選樓層較少，建議留意";
    const flags = [
      pick.preferred ? "符合偏好樓層" : "低於偏好樓層",
      pick.avoided ? "較不偏好的樓層" : "",
    ].filter(Boolean).join(" · ");
    return `<button type="button" class="pick-card" data-pick="${pick.key}-${pick.flat.n}">
      <div class="pick-card-top"><span>第 ${index + 1} 個候選</span><span>同室號尚餘 ${pick.count} 間</span></div>
      <h3>${NAMES[pick.key]} ${pick.flat.f}/F · ${pick.unit}室</h3>
      <p>${flags}<br>${risk}</p></button>`;
  }).join("");
  if (state.profile.selectionAt) {
    const notice = document.createElement("p");
    notice.className = "empty-state";
    const date = state.profile.selectionAt.replace("T", " ");
    notice.textContent = `已確認選樓時段：${date}（香港時間）。候選名單根據已發布資料排列，並非選樓當刻的保證。`;
    target.prepend(notice);
  }
}

function render() {
  if (!state.latest) return;
  const snapshot = current();
  renderQuotas(snapshot);
  renderFilters(snapshot);
  renderCourtSummary(snapshot);
  renderTabs();
  renderMatrix(snapshot);
  renderShortlist(snapshot);
}

function openDetail(key, number) {
  const block = current().blocks[key];
  const flat = block?.flats.find(entry => entry.n === number);
  if (!flat) return;
  const label = flat.s === "available" ? "目前未售" : flat.s === "sold" ? "已售" : "已選";
  const court = block.court;
  const pageNumbers = planPagesForFlat(key, flat.f);
  const imageButtons = [
    '<button type="button" data-page="4">屋苑位置圖</button>',
    ...pageNumbers.map((page, index) =>
      `<button type="button" data-page="${page}" class="${index === 0 ? "active" : ""}">平面圖 ${index + 1}</button>`),
  ];
  const initialPage = pageNumbers[0] || 4;
  if (!pageNumbers.length) imageButtons[0] = '<button type="button" data-page="4" class="active">屋苑位置圖</button>';
  const range = flat.a ? `${LABELS[flat.a]} · ${areaText(block.bands[flat.a])}` : "官方表格未提供已售／已選單位面積";
  const unknownPlan = !pageNumbers.length
    ? "<p class=\"plan-caption\">本機說明書節錄不包含此樓層的平面圖，請參閱房委會的完整售樓說明書。</p>" : "";
  const specialPlan = (court === "kai-yeung" && [6, 15, 24].includes(flat.f))
    || (key === "ying-fai-a" && [7, 16, 25].includes(flat.f))
    || (key === "ying-fai-b" && [6, 15, 24].includes(flat.f));
  $("drawer-content").innerHTML = `
    <p class="eyebrow">FLAT PROFILE / 單位詳情</p>
    <h2 id="drawer-title">${NAMES[key]}<br>${flat.f}/F · ${flat.u}室</h2>
    <span class="drawer-status ${flat.s}">${label}</span>
    <div class="drawer-meta">
      <p><strong>實用面積類別：</strong>${range}</p>
      <p><strong>官方更新：</strong>${officialTime(block.modifiedAt)}</p>
      <p><strong>備註：</strong>配額屬全苑優先計劃，並不保證此單位仍可供選購。</p>
    </div>
    <h3>位置與平面圖</h3>
    <div class="drawer-tabs">${imageButtons.join("")}</div>
    <img class="plan-image" id="plan-image" src="./assets/${court}-${initialPage}.webp"
      alt="${COURT_NAMES[court]}售樓說明書第 ${initialPage} 頁" loading="lazy">
    <p id="plan-caption" class="plan-caption">售樓說明書節錄 · 第 ${initialPage} 頁。請以正式說明書為準。</p>
    ${unknownPlan}
    ${specialPlan ? '<p class="plan-caption">此樓層設有局部平面圖；請連同同頁的局部圖一併核對。</p>' : ""}
    <div class="drawer-links">
      <a id="plan-full-image" class="source-link" href="./assets/${court}-${initialPage}.webp" target="_blank" rel="noopener">放大查看圖片 ↗</a>
      <a id="plan-pdf" class="source-link" href="./brochures/${court}.pdf#page=${initialPage}" target="_blank" rel="noopener">打開本機說明書節錄 ↗</a>
      <a class="source-link" href="https://hos.housingauthority.gov.hk/mini-site/hos2025/tc/index.html" target="_blank" rel="noopener">房委會官方網站 ↗</a>
      <a class="source-link" href="${PDF_BASE}status-${key}.pdf" target="_blank" rel="noopener">打開官方銷售狀態 ↗</a>
    </div>`;
  $("detail-drawer").hidden = false;
  $("detail-drawer").dataset.block = key;
  $("drawer-scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("drawer-close").focus();
}

function closeDetail() {
  $("detail-drawer").hidden = true;
  $("drawer-scrim").hidden = true;
  document.body.style.overflow = "";
}

function updateCooldown() {
  const remain = Math.ceil((state.lastRefresh + 60_000 - Date.now()) / 1000);
  $("refresh-button").disabled = remain > 0;
  $("refresh-button").textContent = remain > 0 ? `${remain} 秒後可再讀取` : "讀取最新已發布資料 ↻";
}

function bindEvents() {
  $("profile-form").addEventListener("submit", saveProfile);
  $("share-button").addEventListener("click", sharePreferences);
  $("share-url").addEventListener("focus", event => event.target.select());
  $("category-filters").addEventListener("click", event => {
    const chip = event.target.closest("[data-category]");
    if (!chip) return;
    const category = chip.dataset.category;
    if (state.categories.has(category)) state.categories.delete(category);
    else state.categories.add(category);
    render();
  });
  $("block-tabs").addEventListener("click", event => {
    const tab = event.target.closest("[data-block]");
    if (!tab) return;
    state.activeBlock = tab.dataset.block;
    $("matrix-scroll").scrollTo({ top: 0, left: 0 });
    renderTabs();
    renderMatrix(current());
  });
  $("matrix").addEventListener("click", event => {
    const cell = event.target.closest("[data-flat]");
    if (cell) openDetail(state.activeBlock, Number(cell.dataset.flat));
  });
  $("shortlist-content").addEventListener("click", event => {
    const card = event.target.closest("[data-pick]");
    if (!card) return;
    const split = card.dataset.pick.lastIndexOf("-");
    openDetail(card.dataset.pick.slice(0, split), Number(card.dataset.pick.slice(split + 1)));
  });
  $("history-select").addEventListener("change", event => {
    state.chosen = event.target.value === "latest" ? "latest" : Number(event.target.value);
    render();
  });
  $("refresh-button").addEventListener("click", () => {
    if (Date.now() - state.lastRefresh < 60_000) return;
    state.lastRefresh = Date.now();
    localStorage.setItem("hos-last-manual-refresh", String(state.lastRefresh));
    updateCooldown();
    loadData();
  });
  $("drawer-close").addEventListener("click", closeDetail);
  $("drawer-scrim").addEventListener("click", closeDetail);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeDetail(); });
  $("drawer-content").addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    const page = button.dataset.page;
    const court = current().blocks[$("detail-drawer").dataset.block].court;
    $("plan-image").src = `./assets/${court}-${page}.webp`;
    $("plan-image").alt = `${COURT_NAMES[court]}售樓說明書第 ${page} 頁`;
    $("plan-full-image").href = `./assets/${court}-${page}.webp`;
    $("plan-pdf").href = `./brochures/${court}.pdf#page=${page}`;
    $("plan-caption").textContent = `售樓說明書節錄 · 第 ${page} 頁。請以正式說明書為準。`;
    $("drawer-content").querySelectorAll("[data-page]").forEach(tab => tab.classList.toggle("active", tab === button));
  });
}

loadProfile();
bindEvents();
updateCooldown();
loadData();
setInterval(loadData, 15 * 60_000);
setInterval(updateCooldown, 1000);
