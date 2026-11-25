/* 진천2 재공품 집계 화면 (wip.html)
 * 원자재 실사와 같은 구글 시트 '입력' 탭에 W 로 시작하는 장소로 쌓는다. 로그인(현장 코드·이름·PIN)·관리자 모드는 원자재 화면과 같이 쓴다.
 * 탭 3개: 재공품(품목별 길이·수량 또는 kg) / 비규격(현장·동별 중량을 넣는 대로 더함) / 공장 밖 스크랩(한 번 잴 때마다 한 줄)
 * 모든 저장은 이 폰의 대기열을 거쳐 보낸다 (통신이 끊겨도 사라지지 않고, 연결되면 보낸다).
 */
const API = (window.APP_CONFIG || {}).apiUrl || "";
const FIRST_MONTH = "2026-11";
const LOC = { WK: "에스제이", WO: "동일", WS: "스카이", WX: "공장 밖" };  // 태흥은 뺐다 (2026-11-18 사용자 요청)
const SHEETS = [
  { key: "wip", name: "재공품", locs: ["WK", "WO", "WS"] },
  { key: "ns", name: "비규격", locs: ["WK", "WO", "WS"] },
  { key: "scrap", name: "공장 밖 스크랩", locs: ["WX"] },
];
const NS_EXPORT = "WS";  // 비규격 스카이 = 수출 탭 (현장명·유형·중량)
const NS_TYPES = ["WALL", "SLAB", "기타"];
const SCRAP_KINDS = ["스크랩", "양분"];
const S = {
  month: null, items: [], sheet: "wip", loc: "WK", tab: "input", q: "", grp: "",
  server: [], entries: [], locks: {}, mgrs: {}, outbox: [], rejected: [], sending: false,
  online: null, syncedAt: null, sig: "", me: "", code: "", pin: "", admin: "", big: false,
  nsSite: "", nsType: "WALL", scrapKind: "스크랩", showDel: false,
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const fmtInt = n => Math.round(n).toLocaleString("ko-KR");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
function evalExpr(expr) {
  const s = String(expr).replace(/\s/g, "").replace(/[x*]/gi, "×");
  if (!s) return null;
  if (!/^[0-9.×+]+$/.test(s)) return NaN;
  let total = 0;
  for (const term of s.split("+")) {
    if (!term) return NaN;
    let p = 1;
    for (const f of term.split("×")) { if (!/^\d+(\.\d+)?$/.test(f)) return NaN; p *= Number(f) }
    total += p;
  }
  return Math.round(total * 1000) / 1000;
}
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const addMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); return ym(new Date(y, mo - 1 + n, 1)) };
const monthLabel = m => { const [y, mo] = m.split("-"); return `${y}년 ${Number(mo)}월말` };
const sheetOf = e => e.loc === "WX" ? "scrap" : e.grp === "비규격" ? "ns" : "wip";
const locName = (k, sheet) => sheet === "ns" && k === NS_EXPORT ? "스카이(수출)" : LOC[k] || k;
const itemKey = x => `${x.grp}|${x.spec}`;
const isKg = e => e.code === "kg";
const mgrsOf = loc => S.mgrs[loc] || [];
const canWrite = loc => !!S.admin || (!!S.me && mgrsOf(loc).includes(S.me));
const isLocked = loc => !!S.locks[loc];
const mine = e => !!S.admin || e.by === S.me;
const active = () => S.entries.filter(e => !e.del);
function fmtTime(ts) {
  const d = new Date(ts); if (isNaN(d)) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function applyBig() {
  document.documentElement.classList.toggle("big", !!S.big);
  $("bigBtn").setAttribute("aria-pressed", String(!!S.big));
}

/* ---------- 품목 목록 (재공품 탭) ---------- */
async function loadItems() {
  const j = await (await fetch("wip-catalog.json", { cache: "no-cache" })).json();
  S.items = j.items.map(it => ({ ...it, key: itemKey(it), hay: `${it.grp} ${GRP_ALIAS[it.grp] || ""} ${it.spec} ${(it.notes || []).join(" ")}`.toLowerCase().replace(/×/g, "x") }));
}
const itemByKey = k => S.items.find(i => i.key === k);
/* 화면 이름: 시트류·A/G 는 두께(63.5·78.5)를 뺀 폭만 (wip_catalog.py 가 label 로 넣는다), 품명 뒤에는 원자재 화면과 같은 한글 이름 */
const itemLabel = it => it.label || it.spec || it.grp;
const GRP_ALIAS = { "ONE SHEET": "원시트", "HALF SHEET": "하프시트", "W-HALF SHEET": "형상: ㅜ", "SHEET BAR": "시트바", "SHEET 보강대": "시트보강대",
  "PROP HEAD": "프롭헤드", "M/BEAM": "MB,EB", "HALF SHEET(면귀)": "하프시트 면귀", "HALF SHEET(콤비)": "하프시트 콤비", "W.E.P": "형상: ㅠ" };
const grpLabel = g => GRP_ALIAS[g] ? `${g} (${GRP_ALIAS[g]})` : g;
/* 목록 이름 강조 (원자재 화면과 같은 규칙): 시트류·A/G 는 폭을, SOFFIT 은 높이·턱(100 턱없음 / 116 턱있음)을 눈에 띄게 */
const tukTag = n => n === "116" ? `<span class="tukt yes">턱O</span>` : n === "100" ? `<span class="tukt no">턱X</span>` : "";
function labelHtml(it) {
  const s = esc(itemLabel(it));
  if (it.label) return s.replace(/\d+(\.\d+)?/g, n => `<b class="key">${n}</b>`);
  if (/^SOFFIT/.test(it.grp)) {
    let i = 0, tuk = "";
    return s.replace(/\d+(\.\d+)?/g, n => { i++; if (i === 2) tuk = n; return i <= 2 ? `<b class="key">${n}</b>` : n }) + tukTag(tuk);
  }
  return s;
}
const wtOf = (it, e) => isKg(e) ? e.qty : it && it.uw && e.len ? e.len / 1000 * it.uw * e.qty : 0;

/* ---------- 구글 시트와 주고받기 ---------- */
async function apiGet(params) {
  const u = new URL(API);
  Object.entries({ ...params, code: S.code }).forEach(([k, v]) => u.searchParams.set(k, v));
  return (await fetch(u, { cache: "no-store" })).json();
}
async function apiPost(body) {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ admin: S.admin || undefined, pin: S.pin || undefined, ...body, code: S.code }) });
  return r.json();
}
const ERR = {
  admin: "관리자 코드가 맞지 않습니다.", noadmin: "관리자 코드가 아직 설정되지 않았습니다.",
  notmgr: "이 장소 담당자만 할 수 있습니다.", action: "저장소가 아직 새 버전이 아닙니다 (Code.gs 새 버전 배포 필요).",
  pin: "PIN이 맞지 않습니다.", nopin: "아직 내 PIN이 정해지지 않았습니다.", locked: "잠긴 장소입니다.",
  wait: "여러 번 틀려서 잠시 막혔습니다. 15~30분 뒤 다시 해 주세요.", expr: "숫자가 올바르지 않습니다.", entry: "입력값이 올바르지 않습니다.",
};
function merge() {
  let list = S.server.map(e => ({ ...e }));
  for (const op of S.outbox) {
    if (op.op === "add" && op.entry.m === S.month && !list.some(e => e.id === op.entry.id)) list.push({ ...op.entry, pending: true });
    if (op.op === "edit") list = list.map(e => e.id === op.id ? { ...e, expr: op.expr, qty: op.qty, memo: op.memo, pending: true,
      edits: [...(e.edits || []), { expr: e.expr, qty: e.qty, memo: e.memo, at: op.at, by: op.by }] } : e);
    if (op.op === "del") list = list.map(e => e.id === op.id ? { ...e, del: true, delBy: op.by, delAt: op.at, pending: true } : e);
  }
  S.entries = list;
}
function mergeAndRender(force) {
  merge();
  const sig = JSON.stringify([S.entries, S.locks, S.mgrs, S.me, S.admin, S.hide]);
  if (force || sig !== S.sig) { S.sig = sig; renderAll() } else renderSync();
}
async function refresh() {
  if (!API || !S.code) { mergeAndRender(true); return }
  const month = S.month;
  try {
    const j = await apiGet({ action: "list", month, form: "wip" });
    if (j.ok === false) { toast(j.error === "code" ? "현장 코드가 맞지 않습니다. 원자재 화면에서 다시 로그인해 주세요." : ERR[j.error] || j.error); mergeAndRender(); return }
    if (month !== S.month) return;
    S.server = j.entries || []; S.locks = j.locks || {}; S.mgrs = j.mgrs || {};
    if (j.hide) { setHide(j.hide); store.set("wip-hide", S.hide) }
    store.set("wip-cache-" + month, S.server); store.set("wip-locks-" + month, S.locks); store.set("wip-mgrs-" + month, S.mgrs);
    S.online = true; S.syncedAt = new Date();
  } catch { S.online = false }
  mergeAndRender();
}
S.outbox = store.get("wip-outbox", []);
S.rejected = store.get("wip-rejected", []);
function saveOutbox() { store.set("wip-outbox", S.outbox); store.set("wip-rejected", S.rejected) }
function enqueue(op) { op.q = newId(); S.outbox.push(op); saveOutbox(); mergeAndRender(true); flush() }
async function flush() {
  if (S.sending || !API || !S.code) return;
  S.sending = true;
  let sent = 0, failed = false;
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      let j;
      try {
        j = op.op === "add" ? await apiPost({ action: "add", entry: op.entry })
          : op.op === "edit" ? await apiPost({ action: "edit", id: op.id, expr: op.expr, qty: op.qty, memo: op.memo, by: op.by })
          : await apiPost({ action: "del", id: op.id, by: op.by });
      }
      catch { failed = true; break }
      if (j.ok === false && (j.error === "code" || j.error === "wait" || j.error === "pin" || j.error === "nopin")) {
        toast((ERR[j.error] || "현장 코드가 맞지 않습니다.") + " 원자재 화면에서 다시 로그인해 주세요. (보내지 못한 입력은 이 폰에 남아 있습니다)"); failed = true; break
      }
      if (j.ok === false && (j.error === "admin" || j.error === "noadmin") && S.admin) { adminOff("관리자 코드가 맞지 않아 관리자 모드를 껐습니다"); continue }
      if (j.ok === false && (j.error === "locked" || j.error === "notmgr")) { S.rejected.push(op); toast(j.error === "locked" ? "잠긴 장소라 저장하지 못한 입력이 있습니다" : "담당 장소가 아니라 저장하지 못한 입력이 있습니다") }
      else if (j.ok === false && j.error === "owner") toast("다른 사람이 입력한 기록은 고치거나 삭제할 수 없습니다");
      else if (j.ok === false) toast(`한 건을 저장하지 못했습니다 (${j.error}).`);
      S.outbox.shift(); saveOutbox(); sent++;
    }
  } finally { S.sending = false }
  S.online = !failed;
  if (sent) await refresh(); else mergeAndRender();
}
function addEntry(data, msg) {
  const entry = { id: newId(), m: S.month, r: null, memo: "", ...data, by: S.me, ts: new Date().toISOString() };
  enqueue({ op: "add", entry });
  toast(msg || "저장했습니다");
}
function deleteEntry(e) {
  enqueue({ op: "del", id: e.id, by: S.me, at: new Date().toISOString() });
  toast("삭제했습니다 (기록은 남습니다)");
}
function adminOff(msg) { S.admin = ""; store.set("rm-admin", ""); if (msg) toast(msg); mergeAndRender(true) }

/* ---------- 머리 부분 ---------- */
function renderAll() { renderSync(); renderSheetBar(); renderLocBar(); renderBanners(); renderView(); if (sheet) drawSheet() }
function renderSync() {
  $("admBadge").hidden = !S.admin;
  const el = $("sync");
  if (!API) { el.textContent = "저장소 미설정"; el.className = "sync off"; return }
  if (S.online === false) { el.textContent = "오프라인"; el.className = "sync off"; return }
  const t = S.syncedAt;
  el.textContent = t ? `동기화 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "연결 중";
  el.className = "sync";
}
function renderSheetBar() {
  $("sheetBar").innerHTML = SHEETS.map(s => `<button data-sheet="${s.key}" aria-pressed="${S.sheet === s.key}">${s.name}</button>`).join("");
}
const LOCK_SVG = `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
function renderLocBar() {
  const sh = SHEETS.find(s => s.key === S.sheet);
  if (!sh.locs.includes(S.loc)) S.loc = sh.locs[0];
  const cnt = loc => active().filter(e => e.loc === loc && sheetOf(e) === S.sheet).length;
  $("locBar").innerHTML = sh.locs.map(l => `<button class="loc${isLocked(l) ? " locked" : ""}" data-loc="${l}" aria-pressed="${S.loc === l}">${isLocked(l) ? LOCK_SVG : ""}${esc(locName(l, S.sheet))}<small>${cnt(l) || ""}</small></button>`).join("");
  document.documentElement.style.setProperty("--hdr", document.querySelector("header").offsetHeight + "px");
}
function renderBanners() {
  const b = [];
  if (!S.code || !S.me) b.push(`<div class="banner warn"><span>원자재 화면에서 먼저 로그인(현장 코드·이름·PIN)해 주세요.</span><a class="formlink" href="./">로그인</a></div>`);
  if (S.outbox.length) b.push(`<div class="banner info"><span>아직 보내지 못한 입력 ${S.outbox.length}건 (연결되면 자동으로 보냅니다)</span><button data-act="flush">지금 보내기</button></div>`);
  if (S.rejected.length) b.push(`<div class="banner warn"><span>잠금·권한 때문에 저장하지 못한 입력 ${S.rejected.length}건</span><button data-act="retry">다시 보내기</button></div>`);
  $("banners").innerHTML = b.join("");
}
function lockBar() {
  const loc = S.loc, name = locName(loc, S.sheet);
  if (isLocked(loc)) return `<div class="lockbar locked"><span>${LOCK_SVG}<b>${esc(LOC[loc])}</b> 입력을 마쳤습니다 (${esc(S.locks[loc].by || "")})</span>${S.admin ? `<button data-dlg-open="unlock">잠금 풀기</button>` : ""}</div>`;
  if (!canWrite(loc)) return `<div class="lockbar"><span>${esc(name)}은(는) ${mgrsOf(loc).length ? esc(mgrsOf(loc).join(", ")) + " 담당입니다 (보기만)" : "담당자가 없어 관리자만 입력합니다"}</span></div>`;
  return `<div class="lockbar"><span>${esc(LOC[loc])} 입력 중${loc !== "WX" ? " · 잠그면 재공품·비규격 모두 닫힙니다" : ""}</span><button data-dlg-open="lock">입력 마치고 잠그기</button></div>`;
}

/* ---------- 입력 화면 ---------- */
function renderView() {
  for (const t of ["input", "sum"]) $("tab-" + t).setAttribute("aria-selected", String(S.tab === t));
  if (S.tab === "sum") { renderSum(); return }
  if (S.sheet === "wip") renderWip();
  else if (S.sheet === "ns") renderNs();
  else renderScrap();
}
const writable = () => canWrite(S.loc) && !isLocked(S.loc);

/* 재공품: 품목마다 한 줄, 누르면 길이·수량(또는 kg)을 넣는 창이 열리고 넣을 때마다 아래에 한 줄씩 쌓인다 */
function wipTally(loc) {
  const m = new Map();
  for (const e of active()) {
    if (e.loc !== loc || sheetOf(e) !== "wip") continue;
    const k = itemKey(e), t = m.get(k) || { n: 0, qty: 0, kg: 0, lens: new Set() };
    t.n++;
    if (isKg(e)) t.kg += e.qty; else { t.qty += e.qty; t.lens.add(e.len) }
    t.kg2 = (t.kg2 || 0) + wtOf(itemByKey(k), e);
    m.set(k, t);
  }
  return m;
}
function renderWip() {
  const tally = wipTally(S.loc);
  const words = S.q.toLowerCase().replace(/×/g, "x").split(/\s+/).filter(Boolean);
  // 관리자가 이 장소에서 숨긴 품목: 이미 입력이 있거나 검색할 때만 보인다
  const nHidden = S.items.filter(it => hiddenAt(it, S.loc)).length;
  let items = S.items.filter(it => (!S.grp || it.grp === S.grp) && words.every(w => it.hay.includes(w))
    && (words.length || tally.has(it.key) || !hiddenAt(it, S.loc)));
  if (S.filt === "done") items = items.filter(it => tally.has(it.key));
  const groups = [...new Set(items.map(i => i.grp))];
  const nDone = S.items.filter(it => tally.has(it.key)).length;
  $("view").innerHTML = `${lockBar()}${nHidden ? `<div class="hidenote">${esc(LOC[S.loc])}에 없는 품목 ${nHidden}개는 목록에서 숨겼습니다. 검색하면 나옵니다.</div>` : ""}
    <div class="search"><input id="q" type="search" placeholder="품명·규격 검색 (예: 시트바 59.5)" value="${esc(S.q)}" autocomplete="off">
      <button type="button" id="grpBtn" class="grpbtn" aria-haspopup="dialog">${esc(S.grp ? grpLabel(S.grp) : "전체 품명")}<span aria-hidden="true">▾</span></button></div>
    <div class="filters"><button class="chip" data-filt="all" aria-pressed="${S.filt !== "done"}">전체</button><button class="chip" data-filt="done" aria-pressed="${S.filt === "done"}">이 장소 입력됨 ${nDone}</button></div>
    <div id="itemList">${groups.map(g => {
      const its = items.filter(i => i.grp === g);
      return `<h3 class="grp"><span>${esc(grpLabel(g))}</span><small>${its.filter(i => tally.has(i.key)).length}/${its.length}</small></h3>
        <div class="list">${its.map(it => {
          const t = tally.get(it.key);
          const q = !t ? `<span class="qty zero">–<small>${esc(LOC[S.loc])}</small></span>`
            : `<span class="qty">${t.qty ? fmtInt(t.qty) + "本" : ""}${t.qty && t.kg ? " + " : ""}${t.kg ? fmt1(t.kg) + "kg" : ""}<small>${t.lens.size ? t.lens.size + "가지 길이" : ""}${t.lens.size && t.kg ? " · " : ""}${t.kg ? "중량" : ""}</small></span>`;
          return `<button class="item${t ? " done" : ""}" data-item="${esc(it.key)}"><span class="spec">${labelHtml(it)}${it.kgOnly ? `<span class="pill">kg</span>` : ""}</span>${q}${hiddenAt(it, S.loc) ? `<span class="meta"><span class="hidtag">${esc(LOC[S.loc])} 목록에서 숨김</span></span>` : ""}</button>`;
        }).join("")}</div>`;
    }).join("") || `<div class="empty">검색에 맞는 품목이 없습니다.</div>`}</div>`;
}
function openGrp() {
  const tally = wipTally(S.loc);
  const vis_ = S.items.filter(i => !hiddenAt(i, S.loc) || tally.has(i.key));
  const groups = [...new Set(vis_.map(i => i.grp))];
  const cnt = g => { const its = vis_.filter(i => !g || i.grp === g); return `${its.filter(i => tally.has(i.key)).length}/${its.length}` };
  const opt = (g, label) => `<button class="gopt" data-gopt="${esc(g)}" aria-pressed="${S.grp === g}"><span>${esc(label)}</span><small>${cnt(g)}</small></button>`;
  $("grpRoot").innerHTML = `<div class="scrim" data-act="grpclose"></div>
    <div class="gpick" role="dialog" aria-modal="true" aria-label="품명 고르기">
      <div class="gpick-h"><b>품명</b><small>${esc(LOC[S.loc])} 입력 품목 수</small><button class="x" data-act="grpclose" aria-label="닫기">✕</button></div>
      <div class="gpick-list">${opt("", "전체 품명")}${groups.map(g => opt(g, grpLabel(g))).join("")}</div></div>`;
  document.querySelector(".gopt[aria-pressed=true]")?.scrollIntoView({ block: "center" });
}

/* 재공품 품목 입력 창: 원자재 입력 창처럼 아래 키패드로 넣는다.
 * 길이·수량 방식은 [길이] 칸에 길이를 넣고 [다음 →] → [수량] 칸에 수량(400×7+3 처럼 묶음도) → [저장].
 * 저장해도 창은 열린 채로 다음 길이를 넣을 수 있고, 넣은 것은 아래에 한 줄씩 쌓인다. */
let sheet = null;  // {key, loc, mode:"len"|"kg", fld:"len"|"qty", len, qty, kg, note, err, fresh}
function openSheet(key) {
  const it = itemByKey(key); if (!it) return;
  sheet = { key, loc: S.loc, mode: it.kgOnly ? "kg" : "len", fld: it.fixLen ? "qty" : "len",
    len: it.fixLen ? String(it.fixLen) : "", qty: "", kg: "", note: "", err: "", fresh: true };
  drawSheet();
}
function closeSheet() { sheet = null; $("sheetRoot").innerHTML = "" }
const sheetWritable = () => canWrite(sheet.loc) && !isLocked(sheet.loc);
function sheetVals() {
  const len = Number(sheet.len), qty = evalExpr(sheet.qty), kg = evalExpr(sheet.kg);
  const lenOk = Number.isInteger(len) && len >= 1 && len <= 20000;
  const qtyOk = typeof qty === "number" && !isNaN(qty) && qty > 0;
  const kgOk = typeof kg === "number" && !isNaN(kg) && kg > 0;
  return { len, qty, kg, lenOk, qtyOk, kgOk, ok: sheet.mode === "kg" ? kgOk : lenOk && qtyOk };
}
function dispHtml() {
  const it = itemByKey(sheet.key), v = sheetVals();
  const fld = (name, label, val, unit, ph) => `<button class="fld${sheet.fld === name ? " on" : ""}" data-fld="${name}"><span>${label}</span><b class="num">${val ? esc(val) : `<i>${ph}</i>`}</b><small>${unit}</small></button>`;
  if (sheet.mode === "kg") {
    return fld("kg", "중량", sheet.kg, "kg", "예: 340") +
      `<div class="res">${v.kgOk ? `= <b>${fmt1(v.kg)}</b> kg` : sheet.kg ? "식이 끝나지 않았습니다" : `${esc(LOC[sheet.loc])}에 저장됩니다`}</div>`;
  }
  const wt = v.ok && it.uw ? ` · ${fmt1(v.len / 1000 * it.uw * v.qty)} kg` : "";
  return fld("len", sheet.editing ? "길이(고정)" : "길이", sheet.len, "mm", "예: 3800") + fld("qty", "수량", sheet.qty, "本", "400×7+3 처럼 묶음도") +
    `<div class="res">${v.ok ? `= ${v.len} mm × <b>${fmtInt(v.qty)}</b>本${wt}` : sheet.qty && !v.qtyOk ? "수량 식이 끝나지 않았습니다" : `${esc(LOC[sheet.loc])}에 저장됩니다`}</div>`;
}
function saveLabel() {
  if (sheet.mode === "len" && sheet.fld === "len") return sheet.lenWarn ? "맞아요, 다음 →" : "다음 →";
  if (sheet.editing) return "수정 저장";
  return sheet.dup ? "또 저장" : "저장";
}
const saveDisabled = v => sheet.mode === "len" && sheet.fld === "len" ? !v.lenOk : !v.ok;
function updateDisp() {
  const d = $("disp"); if (!d) return;
  d.innerHTML = dispHtml();
  const v = sheetVals(), b = $("saveBtn");
  b.textContent = saveLabel();
  b.disabled = saveDisabled(v);
  $("serr").textContent = sheet.err;
}
/* 길이 실수 경고: 그 품목 원자재 길이(rawLen, wip_catalog.py 가 원자재 목록에서 넣음)보다 길거나 30 미만이면 한 번 묻는다.
 * 원자재 길이를 모르는 품목은 6,000 을 기준으로 한다. */
const LEN_DEFAULT = 6000, LEN_MIN = 30;
const lenMax = it => it.rawLen || LEN_DEFAULT;
const oddLen = (it, len) => len > lenMax(it) || len < LEN_MIN;
const oddMsg = (it, len) => `${len.toLocaleString("ko-KR")} mm 가 맞나요? ${len < LEN_MIN ? "아주 짧습니다"
  : it.rawLen ? `원자재 길이(${it.rawLen.toLocaleString("ko-KR")} mm)보다 깁니다` : "6,000 mm 보다 깁니다"}. 맞으면 한 번 더 누르세요.`;
/* 두 번 저장 경고: 10분 안에 내가 같은 장소·품목·길이·수량(또는 kg)을 저장한 기록 */
const DUP_MS = 10 * 60 * 1000;
function findDup(it, v) {
  const now = Date.now();
  return active().filter(e => e.loc === sheet.loc && itemKey(e) === it.key && e.by === S.me && now - new Date(e.ts).getTime() < DUP_MS
      && (sheet.mode === "kg" ? isKg(e) && e.qty === v.kg : !isKg(e) && e.len === v.len && e.qty === v.qty))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] || null;
}
const minsAgo = ts => { const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000); return m < 1 ? "방금" : `${m}분 전에` };
/* 기록 고치기: 수량(또는 kg)·특이사항만. 길이를 틀렸으면 지우고 다시 넣는다. 이전 값은 시트 '수정이력'에 남는다 */
function startEdit(e) {
  sheet.editing = e; sheet.mode = isKg(e) ? "kg" : "len"; sheet.fld = "qty";
  sheet.len = isKg(e) ? "" : String(e.len); sheet.qty = isKg(e) ? "" : e.expr; sheet.kg = isKg(e) ? e.expr : "";
  sheet.note = e.memo || ""; sheet.err = ""; sheet.dup = null; sheet.lenWarn = null;
  drawSheet();
  document.querySelector(".sheet")?.scrollTo({ top: 0, behavior: "smooth" });
}
function cancelEdit() {
  const it = itemByKey(sheet.key);
  Object.assign(sheet, { editing: null, mode: it.kgOnly ? "kg" : "len", fld: it.fixLen ? "qty" : "len", len: it.fixLen ? String(it.fixLen) : "", qty: "", kg: "", err: "" });
  drawSheet();
}
function editEntry(e, expr, qty, memo) {
  enqueue({ op: "edit", id: e.id, expr, qty, memo, by: S.me, at: new Date().toISOString() });
  toast("수정했습니다 (이전 값은 기록에 남습니다)");
}
function entryListHtml(it) {
  const list = S.entries.filter(e => e.loc === sheet.loc && sheetOf(e) === "wip" && itemKey(e) === it.key && (S.showDel || !e.del));
  const live = list.filter(e => !e.del);
  const lk = e => `${e.len}|${e.memo || ""}`;
  const groups = [...new Set(live.filter(e => !isKg(e)).map(lk))].map(k => {
    const es = live.filter(e => !isKg(e) && lk(e) === k);
    return { len: es[0].len, memo: es[0].memo || "", qty: es.reduce((s, e) => s + e.qty, 0) };
  }).sort((a, b) => a.len - b.len || a.memo.localeCompare(b.memo));
  const kgSum = live.filter(isKg).reduce((s, e) => s + e.qty, 0);
  const totWt = live.reduce((s, e) => s + wtOf(it, e), 0);
  const w = sheetWritable();
  const rows = list.slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts))).map(e => `
    <div class="erow${e.del ? " del" : ""}${e.pending ? " pend" : ""}"><span class="t">${isKg(e) ? "중량" : `${e.len ?? "?"} mm`}${e.memo ? ` <span class="pill">${esc(e.memo)}</span>` : ""}</span><span class="v">${isKg(e) ? fmt1(e.qty) + " kg" : fmtInt(e.qty) + "本"}</span>
      <span class="acts">${!e.del && w && mine(e) ? `<button class="editb" data-edit="${esc(e.id)}">수정</button><button data-del="${esc(e.id)}">삭제</button>` : ""}</span>
      <span class="w">${esc(e.expr)} · ${esc(e.by || "")} ${fmtTime(e.ts)}${e.edits?.length ? ` · <span class="tag edit">수정 ${e.edits.length}회: ${e.edits.map(x => esc(x.expr)).join("→")}→${esc(e.expr)}</span>` : ""}${e.del ? ` · 삭제 ${esc(e.delBy || "")}` : ""}</span></div>`).join("");
  return `<div class="grpbox"><div class="grpbox-h"><span>${esc(LOC[sheet.loc])} 입력 ${live.length}건</span><small>${groups.length ? fmtInt(groups.reduce((s, g) => s + g.qty, 0)) + "本" : ""}${kgSum ? ` + ${fmt1(kgSum)}kg` : ""}${totWt ? ` ≈ ${fmt1(totWt)}kg` : ""}</small></div>
    ${groups.map(g => `<div class="lenrow"><span>${g.len} mm${g.memo ? ` · ${esc(g.memo)}` : ""}</span><b>${fmtInt(g.qty)}本</b></div>`).join("")}
    ${kgSum ? `<div class="lenrow"><span>중량</span><b>${fmt1(kgSum)} kg</b></div>` : ""}
    ${rows || `<div class="empty">아직 입력이 없습니다.</div>`}</div>
    <div class="filters" style="margin-top:8px"><button class="chip" data-act="showdel" aria-pressed="${S.showDel}">삭제한 기록도 보기</button></div>`;
}
function drawSheet() {
  if (!sheet) return;
  const it = itemByKey(sheet.key);
  const anim = sheet.fresh ? " anim" : ""; sheet.fresh = false;
  const locs = SHEETS[0].locs.map(l => `<button class="loc${isLocked(l) ? " locked" : ""}" data-sloc="${l}" aria-pressed="${sheet.loc === l}">${isLocked(l) ? LOCK_SVG : ""}${esc(LOC[l])}</button>`).join("");
  const block = isLocked(sheet.loc) ? `<div class="lockbar locked"><span>${LOCK_SVG}<b>${esc(LOC[sheet.loc])}</b>은(는) 잠긴 장소입니다.</span></div>`
    : !canWrite(sheet.loc) ? `<div class="lockbar locked"><span><b>${esc(LOC[sheet.loc])}</b>은(는) ${mgrsOf(sheet.loc).length ? esc(mgrsOf(sheet.loc).join(", ")) + "만 입력할 수 있습니다." : "관리자만 입력합니다."}</span></div>` : "";
  const modeSeg = it.kg && !it.kgOnly ? `<div class="modeseg"><button class="chip" data-mode="len" aria-pressed="${sheet.mode === "len"}">길이 · 수량</button><button class="chip" data-mode="kg" aria-pressed="${sheet.mode === "kg"}">중량(kg)</button></div>` : "";
  const notes = it.notes && it.notes.length ? `<div class="notes">${it.notes.map(n => `<button class="chip" data-note="${esc(n)}" aria-pressed="${sheet.note === n}">${esc(n)}</button>`).join("")}</div>` : "";
  const v = sheetVals();
  $("sheetRoot").innerHTML = `<div class="scrim" data-act="close"></div>
    <div class="sheet${anim}" role="dialog" aria-modal="true" aria-label="재공품 입력">
      <div class="sheet-head"><div><h2 class="spechead">${esc(grpLabel(it.grp))} · ${labelHtml(it)}</h2></div><button class="x" data-act="close" aria-label="닫기">✕</button></div>
      <div class="locs">${locs}</div>
      ${block || `${sheet.editing ? `<div class="editing"><span>입력 고치는 중 (이전 ${esc(sheet.editing.expr)}${isKg(sheet.editing) ? "kg" : "本"}${isKg(sheet.editing) ? "" : `, 길이 ${sheet.editing.len}mm 그대로`})</span><button data-act="canceledit">새로 입력으로</button></div>` : modeSeg}
      <div class="display wipdisp" id="disp">${dispHtml()}</div>
      <div class="memo">${notes}<input id="note" placeholder="특이사항 (선택${it.notes && it.notes.length ? ", 위에서 고르거나 직접" : ""})" value="${esc(sheet.note)}" maxlength="40" autocomplete="off"></div>
      <div class="err" id="serr" style="color:var(--danger);font-size:13px;min-height:1em">${esc(sheet.err)}</div>
      <div class="keys">
        ${["7", "8", "9"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k fn" data-k="back" aria-label="한 글자 지우기">⌫</button>
        ${["4", "5", "6"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k op" data-k="×">×</button>
        ${["1", "2", "3"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k op" data-k="+">+</button>
        <button class="k fn" data-k="clear">지움</button><button class="k" data-k="0">0</button><button class="k save" id="saveBtn" data-act="ssave" style="grid-column: span 2" ${saveDisabled(v) ? "disabled" : ""}>${saveLabel()}</button>
      </div>`}
      <div class="prev">${entryListHtml(it)}</div>
    </div>`;
}
function press(k) {
  if (!sheet || !sheetWritable()) return;
  const f = sheet.mode === "kg" ? "kg" : sheet.fld;
  let s = sheet[f];
  if (k === "back") s = s.slice(0, -1);
  else if (k === "clear") s = "";
  else if (k === "×" || k === "+" || k === ".") { if (f === "len" || !s || /[×+.]$/.test(s)) return; s += k }
  else s += k;
  if (s.length > (f === "len" ? 5 : 40)) return;
  if (f === "len" && sheet.editing) return;  // 고칠 때 길이는 못 바꾼다
  sheet[f] = s; sheet.err = ""; sheet.dup = null; if (f === "len") sheet.lenWarn = null; updateDisp();
}
function saveWip() {
  const it = itemByKey(sheet.key), v = sheetVals();
  if (!sheetWritable()) return;
  if (sheet.mode === "len" && sheet.fld === "len") {
    if (!v.lenOk) return;
    if (oddLen(it, v.len) && sheet.lenWarn !== v.len) {
      sheet.lenWarn = v.len;
      sheet.err = oddMsg(it, v.len);
      updateDisp(); return;
    }
    sheet.fld = "qty"; sheet.err = ""; updateDisp(); return;
  }
  if (!v.ok) { sheet.err = sheet.mode === "kg" ? "중량을 넣어 주세요." : !v.lenOk ? "길이를 mm 숫자로 넣어 주세요." : "수량을 넣어 주세요."; updateDisp(); return }
  const note = ($("note")?.value || "").trim().slice(0, 40);
  sheet.note = note;
  if (sheet.editing) {
    const e = sheet.editing;
    if (!(S.admin || e.by === S.me)) { toast("다른 사람이 입력한 기록은 고칠 수 없습니다"); return }
    editEntry(e, sheet.mode === "kg" ? sheet.kg : sheet.qty, sheet.mode === "kg" ? v.kg : v.qty, note);
    cancelEdit(); return;
  }
  // 길이 칸을 건너뛰고 수량으로 바로 왔어도 이상한 길이는 한 번 묻는다
  if (sheet.mode === "len" && oddLen(it, v.len) && sheet.lenWarn !== v.len) {
    sheet.lenWarn = v.len; sheet.err = oddMsg(it, v.len); updateDisp(); return;
  }
  if (!sheet.dup) {
    const d = findDup(it, v);
    if (d) { sheet.dup = d; sheet.err = `${minsAgo(d.ts)} 같은 값을 이미 저장했습니다. 한 번 더 누르면 또 저장됩니다.`; updateDisp(); return }
  }
  sheet.dup = null; sheet.lenWarn = null;
  if (sheet.mode === "kg") {
    addEntry({ loc: sheet.loc, grp: it.grp, spec: it.spec, len: null, code: "kg", expr: sheet.kg, qty: v.kg, memo: note }, `저장: ${itemLabel(it)} ${fmt1(v.kg)}kg`);
    sheet.kg = "";
  } else {
    addEntry({ loc: sheet.loc, grp: it.grp, spec: it.spec, len: v.len, code: "", expr: sheet.qty, qty: v.qty, memo: note }, `저장: ${v.len}mm ${fmtInt(v.qty)}本`);
    sheet.qty = "";
    if (!it.fixLen) { sheet.len = ""; sheet.fld = "len" }
  }
  sheet.err = "";
  drawSheet();
}

/* 비규격: 현장·동을 넣고 중량을 넣으면 넣는 대로 더해진다 (현장별로 묶어 보여줌) */
function renderNs() {
  const exp = S.loc === NS_EXPORT, w = writable();
  const list = S.entries.filter(e => e.loc === S.loc && sheetOf(e) === "ns" && (S.showDel || !e.del));
  const sites = [...new Set(list.map(e => e.spec))];
  const liveSites = [...new Set(list.filter(e => !e.del).map(e => e.spec))];
  const prevSites = [...new Set(store.get("wip-cache-" + addMonth(S.month, -1), []).filter(e => e.loc === S.loc && e.grp === "비규격").map(e => e.spec))];
  const allSites = [...new Set([...sites, ...prevSites])];
  const total = list.filter(e => !e.del).reduce((s, e) => s + e.qty, 0);
  $("view").innerHTML = `${lockBar()}
    ${w ? `<div class="form"><h3>${esc(locName(S.loc, "ns"))} 비규격 추가</h3>
      <label>현장명 - 동<input id="nsSite" list="siteList" placeholder="예: 미래테크 - 과천 106동" value="${esc(S.nsSite)}" maxlength="60" autocomplete="off"></label>
      <datalist id="siteList">${allSites.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      ${liveSites.length ? `<div class="sitepick"><small>이번 달 넣은 현장 (누르면 그 현장으로)</small><div class="notes">${liveSites.map(s => `<button class="chip" data-site="${esc(s)}" aria-pressed="${S.nsSite === s}">${esc(s)}</button>`).join("")}</div></div>` : ""}
      <div class="row">${exp ? `<label style="flex:0 0 96px">유형<select id="nsType">${NS_TYPES.map(t => `<option ${S.nsType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
        <label>중량 (kg)<input id="nsKg" class="num" inputmode="decimal" placeholder="예: 130" autocomplete="off"></label><button class="btn" data-act="addns">추가</button></div>
      <p class="hint">같은 현장·동을 또 넣으면 집계표에서 합쳐집니다. 이름이 한 글자라도 다르면 다른 현장이 되니, 이미 넣은 현장은 위 버튼으로 고르세요.</p>
      <p class="err" id="nsErr"></p></div>` : ""}
    <div class="filters" style="margin-top:10px"><span class="logsum" style="flex:1;text-align:left">현장 ${sites.length}곳 · 합계 ${fmt1(total)} kg</span><button class="chip" data-act="showdel" aria-pressed="${S.showDel}">삭제한 기록도 보기</button></div>
    ${sites.map(site => {
      const es = list.filter(e => e.spec === site);
      const sum = es.filter(e => !e.del).reduce((s, e) => s + e.qty, 0);
      return `<div class="grpbox"><div class="grpbox-h"><span>${esc(site)}</span><span><small>${fmt1(sum)} kg</small> ${w ? `<button data-site="${esc(site)}" aria-label="${esc(site)}에 추가">＋</button>` : ""}</span></div>
        ${es.map(e => `<div class="erow${e.del ? " del" : ""}${e.pending ? " pend" : ""}"><span class="t">${exp ? esc(e.code || "") : ""}</span><span class="v">${fmt1(e.qty)} kg</span>
          <span class="acts">${!e.del && w && mine(e) ? `<button data-del="${esc(e.id)}">삭제</button>` : ""}</span><span class="w">${esc(e.by || "")} ${fmtTime(e.ts)}</span></div>`).join("")}</div>`;
    }).join("") || `<div class="empty">아직 입력이 없습니다.</div>`}`;
}
function addNs() {
  const site = $("nsSite").value.trim().replace(/\s+/g, " "), v = $("nsKg").value.trim(), kg = evalExpr(v);
  const err = m => { $("nsErr").textContent = m };
  if (!site) { err("현장명 - 동을 넣어 주세요."); $("nsSite").focus(); return }
  if (!kg || isNaN(kg)) { err("중량을 숫자로 넣어 주세요."); $("nsKg").focus(); return }
  const type = S.loc === NS_EXPORT ? ($("nsType")?.value || "WALL") : "";
  S.nsSite = site; if (type) S.nsType = type;
  addEntry({ loc: S.loc, grp: "비규격", spec: site, len: null, code: type, expr: v, qty: kg }, `저장: ${site} ${fmt1(kg)}kg`);
  setTimeout(() => $("nsKg")?.focus(), 0);
}

/* 공장 밖 스크랩: 잴 때마다 한 줄 (집계표에도 한 줄씩 들어간다) */
function renderScrap() {
  const w = writable();
  const list = S.entries.filter(e => e.loc === "WX" && (S.showDel || !e.del)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  $("view").innerHTML = `${lockBar()}
    ${w ? `<div class="form"><h3>공장 밖 스크랩 추가</h3>
      <div class="modeseg">${SCRAP_KINDS.map(k => `<button class="chip" data-kind="${k}" aria-pressed="${S.scrapKind === k}">${k}</button>`).join("")}</div>
      <div class="row"><label>중량 (kg)<input id="scKg" class="num" inputmode="decimal" placeholder="예: 601" autocomplete="off"></label><button class="btn" data-act="addscrap">추가</button></div>
      <p class="hint">한 번 잴 때마다 넣습니다. 집계표에는 넣은 순서대로 한 줄씩 들어갑니다.</p><p class="err" id="scErr"></p></div>` : ""}
    <div class="filters" style="margin-top:10px"><span style="flex:1"></span><button class="chip" data-act="showdel" aria-pressed="${S.showDel}">삭제한 기록도 보기</button></div>
    ${SCRAP_KINDS.map(k => {
      const es = list.filter(e => e.grp === k);
      const sum = es.filter(e => !e.del).reduce((s, e) => s + e.qty, 0);
      let n = 0;
      return `<div class="grpbox"><div class="grpbox-h"><span>${k} ${es.filter(e => !e.del).length}건</span><small>${fmt1(sum)} kg</small></div>
        ${es.map(e => `<div class="erow${e.del ? " del" : ""}${e.pending ? " pend" : ""}"><span class="t">${e.del ? "" : ++n}</span><span class="v">${fmt1(e.qty)} kg</span>
          <span class="acts">${!e.del && w && mine(e) ? `<button data-del="${esc(e.id)}">삭제</button>` : ""}</span><span class="w">${esc(e.by || "")} ${fmtTime(e.ts)}</span></div>`).join("") || `<div class="empty">아직 없습니다.</div>`}</div>`;
    }).join("")}`;
}
function addScrap() {
  const v = $("scKg").value.trim(), kg = evalExpr(v);
  if (!kg || isNaN(kg)) { $("scErr").textContent = "중량을 숫자로 넣어 주세요."; $("scKg").focus(); return }
  addEntry({ loc: "WX", grp: S.scrapKind, spec: "", len: null, code: "kg", expr: v, qty: kg }, `저장: ${S.scrapKind} ${fmt1(kg)}kg`);
  setTimeout(() => $("scKg")?.focus(), 0);
}

/* ---------- 집계표 보기: 엑셀 양식에 들어갈 모양 그대로 ---------- */
function renderSum() {
  const a = active();
  let html = "";
  if (S.sheet === "wip") {
    const cols = ["WK", "WO", "WS"];
    const rows = new Map();  // key|len → {it, len, kg, q:{loc:qty}}
    for (const e of a) {
      if (sheetOf(e) !== "wip") continue;
      const k = itemKey(e) + "|" + (isKg(e) ? "kg" : e.len) + "|" + (e.memo || "");
      const r = rows.get(k) || { key: itemKey(e), grp: e.grp, spec: e.spec, len: isKg(e) ? null : e.len, kg: isKg(e), memo: e.memo || "", q: {} };
      r.q[e.loc] = (r.q[e.loc] || 0) + e.qty; rows.set(k, r);
    }
    const order = new Map(S.items.map((it, i) => [it.key, i]));
    const list = [...rows.values()].sort((x, y) => (order.get(x.key) ?? 1e9) - (order.get(y.key) ?? 1e9) || (x.kg - y.kg) || (x.len || 0) - (y.len || 0) || x.memo.localeCompare(y.memo));
    let lastKey = "", totWt = 0;
    const body = list.map(r => {
      const it = itemByKey(r.key), sum = cols.reduce((s, c) => s + (r.q[c] || 0), 0);
      const wt = r.kg ? sum : it && it.uw && r.len ? r.len / 1000 * it.uw * sum : 0;
      totWt += wt;
      const head = r.key !== lastKey ? `<tr class="sub"><td class="l" colspan="6">${esc(r.grp)} ${esc(it ? itemLabel(it) : r.spec)}</td></tr>` : "";
      lastKey = r.key;
      return `${head}<tr><td class="l">${r.kg ? "중량환산(kg)" : r.len + " mm"}${r.memo ? ` <small>${esc(r.memo)}</small>` : ""}</td>${cols.map(c => `<td>${r.q[c] ? (r.kg ? fmt1(r.q[c]) : fmtInt(r.q[c])) : ""}</td>`).join("")}<td>${r.kg ? fmt1(sum) : fmtInt(sum)}</td><td>${fmt1(wt)}</td></tr>`;
    }).join("");
    html = `<p class="cmpnote">재공품 탭에 들어갈 값입니다 (입력된 품목만). 중량은 길이 × 수량 × kg/m 로 계산한 참고값입니다.</p>
      <div class="tbl"><table class="sumtbl"><thead><tr><th class="l">길이</th><th>SJ</th><th>동일</th><th>SKY</th><th>계</th><th>중량kg</th></tr></thead>
      <tbody>${body || `<tr><td class="l" colspan="6">아직 입력이 없습니다.</td></tr>`}</tbody>${body ? `<tfoot><tr class="tot"><td class="l" colspan="5">중량 합계</td><td>${fmt1(totWt)}</td></tr></tfoot>` : ""}</table></div>`;
  } else if (S.sheet === "ns") {
    const sec = (loc, title) => {
      const m = new Map();
      a.filter(e => e.loc === loc && sheetOf(e) === "ns").forEach(e => { const k = e.spec + "|" + (loc === NS_EXPORT ? e.code : ""); const r = m.get(k) || { site: e.spec, type: e.code, kg: 0, n: 0 }; r.kg += e.qty; r.n++; m.set(k, r) });
      const rs = [...m.values()], sum = rs.reduce((s, r) => s + r.kg, 0);
      return { sum, html: `<tr class="sub"><td class="l" colspan="3">${esc(title)}</td></tr>${rs.map((r, i) => `<tr><td class="l">${i + 1}. ${esc(r.site)}${loc === NS_EXPORT ? ` <small>${esc(r.type || "")}</small>` : ""}</td><td>${r.n}건</td><td>${fmt1(r.kg)}</td></tr>`).join("") || `<tr><td class="l" colspan="3">없음</td></tr>`}<tr><td class="l">소계</td><td></td><td><b>${fmt1(sum)}</b></td></tr>` };
    };
    const k = sec("WK", "SJ산업"), o = sec("WO", "동일"), x = sec(NS_EXPORT, "비규격(진2 수출) · 스카이");
    html = `<p class="cmpnote">비규격 탭: 같은 현장·동은 합쳐서 한 줄로 들어갑니다.</p>
      <div class="tbl"><table class="sumtbl"><thead><tr><th class="l">현장명</th><th>입력</th><th>중량kg</th></tr></thead>
      <tbody>${k.html}${o.html}<tr class="tot"><td class="l" colspan="2">내수 합계</td><td>${fmt1(k.sum + o.sum)}</td></tr>${x.html}</tbody></table></div>`;
  } else {
    html = `<p class="cmpnote">공장 밖 스크랩 탭: 넣은 순서대로 한 줄씩 들어갑니다.</p>` + SCRAP_KINDS.map(k => {
      const es = a.filter(e => e.loc === "WX" && e.grp === k).sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
      const sum = es.reduce((s, e) => s + e.qty, 0);
      return `<div class="tbl" style="margin-top:10px"><table class="sumtbl"><thead><tr><th class="l">${k}</th><th>중량kg</th></tr></thead><tbody>${es.map((e, i) => `<tr><td class="l">${i + 1}</td><td>${fmt1(e.qty)}</td></tr>`).join("") || `<tr><td class="l" colspan="2">없음</td></tr>`}<tr class="sub"><td class="l">소계</td><td>${fmt1(sum)}</td></tr></tbody></table></div>`;
    }).join("");
  }
  const adminCard = `<div class="card" style="margin:14px 0 28px"><h2>관리자</h2>
    <p>${S.admin ? "관리자 모드입니다. 모든 장소에 입력·삭제하고 잠금을 풀 수 있습니다." : "관리자 코드를 넣으면 모든 장소에 입력하고 잠금을 풀 수 있습니다 (원자재 화면과 같이 켜지고 꺼집니다)."}</p>
    <p>담당자: 에스제이·동일·스카이는 원자재 담당자를 그대로 씁니다${S.admin ? ". 공장 밖은 아래에서 정합니다 (비워 두면 관리자만 입력)" : ""}.</p>
    <div class="dlg-btns" style="justify-content:flex-start;flex-wrap:wrap">${S.admin ? `<button class="btn ghost" data-dlg-open="mgrs">공장 밖 담당자</button><button class="btn ghost" data-act="visopen">장소별 품목 숨기기</button><button class="btn ghost" data-act="adminoff">관리자 모드 끄기</button>` : `<button class="btn ghost" data-dlg-open="admin">관리자 모드 켜기</button>`}</div></div>`;
  $("view").innerHTML = `<div class="sum" style="padding-bottom:0">${html}</div>${adminCard}`;
}

/* ---------- 장소별 품목 숨기기 (관리자): 그 장소에 없는 품목은 재공품 입력 목록에서 숨긴다 ----------
 * 구글 시트 '구역품목' 탭에 장소(WK·WO·WS)별로 "품명|규격" 을 저장 (원자재와 같은 탭, 달과 상관없이 계속 적용). 엑셀 반영에는 영향 없음. */
S.hide = {}; let hideSet = {};
function setHide(h) { S.hide = h || {}; hideSet = Object.fromEntries(Object.entries(S.hide).map(([k, v]) => [k, new Set(v)])) }
const hiddenAt = (it, loc) => !!hideSet[loc]?.has(it.key);
let vis = null;  // {loc, hidden:Set, dirty, q}
function openVis() {
  const loc = SHEETS[0].locs.includes(S.loc) ? S.loc : "WK";
  vis = { loc, hidden: new Set(S.hide[loc] || []), dirty: false, q: "" };
  drawVis();
}
function closeVis() {
  if (vis?.dirty && !confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
  vis = null; $("visRoot").innerHTML = "";
}
function drawVis() {
  if (!vis) { $("visRoot").innerHTML = ""; return }
  $("visRoot").innerHTML = `
    <div class="vispanel" role="dialog" aria-modal="true" aria-label="장소별 품목 숨기기">
      <div class="vis-h"><b>장소별 품목 숨기기</b><button class="x" data-act="visclose" aria-label="닫기">✕</button></div>
      <div class="vis-locs">${SHEETS[0].locs.map(l => `<button class="loc" data-visloc="${l}" aria-pressed="${vis.loc === l}">${LOC[l]}<small>${(S.hide[l] || []).length ? "숨김 " + S.hide[l].length : ""}</small></button>`).join("")}</div>
      <p class="vis-note">끈 품목은 <b>${esc(LOC[vis.loc])}</b> 재공품 입력 목록에서 숨깁니다. 검색하면 나오고, 이미 입력이 있으면 보입니다. 엑셀 반영에는 영향이 없습니다.</p>
      <div class="vis-bar"><input id="visq" type="search" placeholder="품명·규격 검색" value="${esc(vis.q)}" autocomplete="off"><span id="visCnt"></span></div>
      <div class="vis-list" id="visList"></div>
      <div class="vis-btns"><button class="btn ghost" data-act="visclose">닫기</button><button class="btn" data-act="vissave" id="visSave"></button></div>
    </div>`;
  drawVisList();
}
function drawVisList() {
  const el = $("visList"); if (!el) return;
  const top = el.scrollTop;
  const words = vis.q.toLowerCase().replace(/×/g, "x").split(/\s+/).filter(Boolean);
  const items = S.items.filter(it => words.every(w => it.hay.includes(w)));
  const groups = [...new Set(items.map(i => i.grp))];
  el.innerHTML = groups.map(g => {
    const its = items.filter(i => i.grp === g), on = its.filter(i => !vis.hidden.has(i.key)).length;
    return `<section><div class="vis-g"><b>${esc(grpLabel(g))}</b><button class="linkbtn" data-visgrp="${esc(g)}">${on === its.length ? "모두 끄기" : "모두 켜기"}</button></div>
      ${its.map(it => { const off = vis.hidden.has(it.key); return `<label class="vis-it${off ? " off" : ""}"><input type="checkbox" data-viskey="${esc(it.key)}" ${off ? "" : "checked"}><span>${esc(itemLabel(it))}</span></label>` }).join("")}</section>`;
  }).join("") || `<div class="empty">검색에 맞는 품목이 없습니다.</div>`;
  el.scrollTop = top;
  $("visCnt").textContent = `보임 ${S.items.filter(it => !vis.hidden.has(it.key)).length} / ${S.items.length}`;
  const b = $("visSave"); b.disabled = !vis.dirty; b.textContent = vis.dirty ? "저장" : "저장됨";
}
async function saveVis() {
  if (!vis || !vis.dirty) return;
  const b = $("visSave"); b.disabled = true; b.textContent = "저장 중…";
  let j;
  try { j = await apiPost({ action: "sethide", loc: vis.loc, keys: [...vis.hidden], by: S.me }) } catch { j = { ok: false, error: "net" } }
  if (!vis) return;
  if (j.ok === false) {
    toast(j.error === "net" ? "통신이 안 됩니다. 연결된 곳에서 다시 저장해 주세요." : ERR[j.error] || `저장하지 못했습니다 (${j.error}).`);
    if (j.error === "admin" || j.error === "noadmin") { vis = null; drawVis(); adminOff() } else drawVisList();
    return;
  }
  setHide(j.hide); store.set("wip-hide", S.hide);
  vis.dirty = false;
  toast(`${LOC[vis.loc]} 품목 설정을 저장했습니다`);
  drawVis(); renderAll();
}

/* ---------- 대화창: 잠금·해제·관리자·담당자 ---------- */
let dlg = null;
function openDlg(kind) { dlg = { kind, loc: S.loc, err: "", busy: false }; drawDlg() }
function closeDlg() { dlg = null; $("dlgRoot").innerHTML = "" }
function drawDlg() {
  if (!dlg) return;
  const name = LOC[dlg.loc], mon = monthLabel(S.month);
  let body, ok;
  if (dlg.kind === "lock") {
    const n = active().filter(e => e.loc === dlg.loc).length;
    body = `<h2>${esc(name)} 입력을 마칠까요?</h2><p>잠그면 ${esc(mon)} ${esc(name)}${dlg.loc !== "WX" ? "의 재공품·비규격" : ""}에는 누구도 입력·삭제할 수 없습니다. 지금까지 입력 ${n}건은 그대로 남습니다. 다시 고치려면 관리자가 풀어야 합니다.</p>`;
    ok = "잠그기";
  } else if (dlg.kind === "unlock") {
    body = `<h2>${esc(name)} 잠금 해제</h2><p>풀면 담당자가 다시 입력·삭제할 수 있습니다.</p>`; ok = "잠금 해제";
  } else if (dlg.kind === "admin") {
    body = `<h2>관리자 모드</h2><input id="adminCode" type="password" inputmode="numeric" maxlength="12" placeholder="관리자 코드" autocomplete="off">`; ok = "켜기";
  } else {
    const v = dlg.vals || { WX: mgrsOf("WX").join(", ") };
    body = `<h2>${esc(mon)} 공장 밖 담당자</h2><p>원자재 화면에 등록한 이름(PIN 있는 사람)과 똑같이 쓰고, 여러 명이면 쉼표로 나눕니다. 비워 두면 관리자만 입력합니다.</p>
      <div class="dlg-body">${["WX"].map(l => `<div class="mgr-row"><label for="mgr-${l}">${LOC[l]}</label><input id="mgr-${l}" value="${esc(v[l] || "")}" autocomplete="off"></div>`).join("")}</div>`;
    ok = "저장";
  }
  $("dlgRoot").innerHTML = `<div class="scrim" data-dlg="close"></div><div class="dlg" role="dialog" aria-modal="true">${body}
    <div class="err">${esc(dlg.err)}</div><div class="dlg-btns"><button class="btn ghost" data-dlg="close">취소</button><button class="btn" data-dlg="ok" ${dlg.busy ? "disabled" : ""}>${dlg.busy ? "처리 중…" : ok}</button></div></div>`;
  $("adminCode")?.focus();
}
async function submitDlg() {
  if (!dlg || dlg.busy) return;
  const { kind, loc } = dlg;
  let body;
  if (kind === "admin") {
    const code = ($("adminCode")?.value || "").trim();
    if (!code) { dlg.err = "코드를 넣어 주세요."; drawDlg(); return }
    body = { action: "admin", admin: code };
  } else if (kind === "mgrs") {
    dlg.vals = { WX: $("mgr-WX").value };
    const mgrs = Object.fromEntries(Object.entries(dlg.vals).map(([k, v]) => [k, [...new Set(String(v).split(/[,，]/).map(s => s.trim()).filter(Boolean))]]));
    body = { action: "setmgrs", month: S.month, mgrs, by: S.me };
  } else {
    if (S.outbox.length) { dlg.err = "아직 보내지 못한 입력이 있습니다. 먼저 보낸 뒤 다시 해 주세요."; drawDlg(); flush(); return }
    body = { action: kind, month: S.month, loc, by: S.me };
  }
  dlg.busy = true; dlg.err = ""; drawDlg();
  let j;
  try { j = await apiPost(body) } catch { if (dlg) { dlg.busy = false; dlg.err = "통신이 안 됩니다."; drawDlg() } return }
  if (!dlg) return;
  dlg.busy = false;
  if (j.ok === false) { dlg.err = ERR[j.error] || `처리하지 못했습니다 (${j.error}).`; if (kind !== "admin" && (j.error === "admin" || j.error === "noadmin") && S.admin) adminOff(); drawDlg(); return }
  closeDlg();
  if (kind === "admin") { S.admin = body.admin; store.set("rm-admin", S.admin); toast("관리자 모드를 켰습니다"); mergeAndRender(true); return }
  if (kind === "mgrs") { S.mgrs = j.mgrs || S.mgrs; toast("담당자를 저장했습니다"); mergeAndRender(true); refresh(); return }
  S.locks = j.locks || S.locks;
  toast(kind === "lock" ? `${LOC[loc]}을(를) 잠갔습니다` : `${LOC[loc]} 잠금을 풀었습니다`);
  mergeAndRender(true); refresh();
}

/* ⌫ 길게 누르면(0.5초) 그 칸을 한 번에 다 지운다 (원자재 화면과 같음). 손을 뗄 때 오는 click 은 무시 */
let lpTimer = null, lpFired = false;
const lpDone = () => { const f = lpFired; lpFired = false; return f };
document.addEventListener("pointerdown", ev => {
  if (!ev.target.closest?.('[data-k="back"]')) return;
  lpFired = false; clearTimeout(lpTimer);
  lpTimer = setTimeout(() => { lpFired = true; press("clear"); navigator.vibrate?.(30) }, 500);
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => document.addEventListener(t, () => clearTimeout(lpTimer), true));
document.addEventListener("contextmenu", ev => { if (ev.target.closest?.(".k")) ev.preventDefault() });

let toastTimer;
function toast(msg) {
  clearTimeout(toastTimer);
  $("toastRoot").innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  toastTimer = setTimeout(() => { $("toastRoot").innerHTML = "" }, 2600);
}

/* ---------- 누르기·입력 ---------- */
document.addEventListener("click", ev => {
  const t = ev.target.closest("button, [data-act], [data-dlg]");
  if (!t) return;
  const d = t.dataset;
  if (t.id === "bigBtn") { S.big = !S.big; store.set("rm-big", S.big); applyBig(); return }
  if (t.id === "grpBtn") { openGrp(); return }
  if (t.id === "tab-input" || t.id === "tab-sum") { S.tab = t.id.slice(4); store.set("wip-tab", S.tab); renderView(); return }
  if (d.sheet) { S.sheet = d.sheet; S.q = ""; S.grp = ""; store.set("wip-sheet", S.sheet); renderAll(); window.scrollTo(0, 0); return }
  if (d.loc) { S.loc = d.loc; store.set("wip-loc-" + S.sheet, S.loc); renderLocBar(); renderView(); return }
  if (d.gopt !== undefined) { S.grp = d.gopt; $("grpRoot").innerHTML = ""; renderView(); window.scrollTo(0, 0); return }
  if (d.filt) { S.filt = d.filt; renderView(); return }
  if (d.item) { openSheet(d.item); return }
  if (d.mode) { sheet.mode = d.mode; sheet.err = ""; drawSheet(); return }
  if (d.k) { if (d.k === "back" && lpDone()) return; press(d.k); return }
  if (d.fld) { if (!(sheet.editing && d.fld === "len")) { sheet.fld = d.fld; updateDisp() } return }
  if (d.edit) { const e = S.entries.find(x => x.id === d.edit); if (e && sheet) startEdit(e); return }
  if (d.sloc) { sheet.loc = d.sloc; S.loc = d.sloc; store.set("wip-loc-" + S.sheet, S.loc); renderLocBar(); renderView(); drawSheet(); return }
  if (d.note !== undefined) { sheet.note = sheet.note === d.note ? "" : d.note; const n = $("note"); if (n) n.value = sheet.note; document.querySelectorAll("[data-note]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.note === sheet.note))); return }
  if (d.kind) { S.scrapKind = d.kind; renderView(); return }
  if (d.site) { S.nsSite = d.site; renderView(); $("nsKg")?.focus(); return }
  if (d.del) {
    const e = S.entries.find(x => x.id === d.del);
    if (e && confirm(`이 입력을 삭제할까요? (${isKg(e) || e.grp === "비규격" ? fmt1(e.qty) + "kg" : e.len + "mm " + fmtInt(e.qty) + "本"})`)) deleteEntry(e);
    return;
  }
  if (d.dlgOpen) { openDlg(d.dlgOpen); return }
  if (d.dlg === "close") { closeDlg(); return }
  if (d.dlg === "ok") { submitDlg(); return }
  switch (d.act) {
    case "grpclose": $("grpRoot").innerHTML = ""; return;
    case "close": closeSheet(); return;
    case "ssave": saveWip(); return;
    case "canceledit": cancelEdit(); return;
    case "addns": addNs(); return;
    case "addscrap": addScrap(); return;
    case "showdel": S.showDel = !S.showDel; renderView(); if (sheet) drawSheet(); return;
    case "flush": flush(); return;
    case "retry": S.outbox.push(...S.rejected); S.rejected = []; saveOutbox(); flush(); return;
    case "adminoff": adminOff("관리자 모드를 껐습니다"); return;
    case "visopen": openVis(); return;
    case "visclose": closeVis(); return;
    case "vissave": saveVis(); return;
  }
  if (vis && d.visloc) {
    if (vis.dirty && !confirm("저장하지 않은 변경이 있습니다. 버리고 장소를 바꿀까요?")) return;
    vis = { loc: d.visloc, hidden: new Set(S.hide[d.visloc] || []), dirty: false, q: vis.q }; drawVis(); return;
  }
  if (vis && d.visgrp !== undefined) {
    const its = S.items.filter(i => i.grp === d.visgrp), allOn = its.every(i => !vis.hidden.has(i.key));
    its.forEach(i => allOn ? vis.hidden.add(i.key) : vis.hidden.delete(i.key));
    vis.dirty = true; drawVisList(); return;
  }
});
document.addEventListener("input", ev => {
  if (ev.target.id === "q") { S.q = ev.target.value; const pos = ev.target.selectionStart; renderView(); const q = $("q"); q.focus(); q.setSelectionRange(pos, pos) }
  if (ev.target.id === "nsSite") S.nsSite = ev.target.value;
  if (ev.target.id === "visq" && vis) { vis.q = ev.target.value; drawVisList() }
  if (ev.target.id === "note" && sheet) { sheet.note = ev.target.value; document.querySelectorAll("[data-note]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.note === sheet.note.trim()))) }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") { if (dlg) closeDlg(); else if ($("grpRoot").innerHTML) $("grpRoot").innerHTML = ""; else if (sheet) closeSheet(); return }
  // 입력 창이 열려 있고 글자 칸에 있지 않으면 PC 키보드 숫자도 키패드처럼 받는다
  if (sheet && !dlg && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) {
    const m = { Backspace: "back", Delete: "clear", "*": "×", x: "×", "+": "+", ".": "." };
    if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); return }
    if (m[ev.key]) { ev.preventDefault(); press(m[ev.key]); return }
    if (ev.key === "Enter") { ev.preventDefault(); saveWip(); return }
  }
  if (ev.key !== "Enter") return;
  const id = ev.target.id;
  if (id === "note") { ev.preventDefault(); ev.target.blur() }
  else if (id === "nsSite") { ev.preventDefault(); $("nsKg")?.focus() }
  else if (id === "nsKg") { ev.preventDefault(); addNs() }
  else if (id === "scKg") { ev.preventDefault(); addScrap() }
  else if (id === "adminCode") { ev.preventDefault(); submitDlg() }
});
$("monthSel").addEventListener("change", ev => setMonth(ev.target.value));
document.addEventListener("change", ev => {
  const k = ev.target.dataset?.viskey;
  if (!vis || k === undefined) return;
  ev.target.checked ? vis.hidden.delete(k) : vis.hidden.add(k);
  vis.dirty = true; drawVisList();
});

function setMonth(m) {
  S.month = m; store.set("rm-month", m);
  S.server = store.get("wip-cache-" + m, []); S.locks = store.get("wip-locks-" + m, {}); S.mgrs = store.get("wip-mgrs-" + m, {});
  S.sig = ""; mergeAndRender(true); refresh();
}

/* ---------- 시작 ---------- */
(async function init() {
  S.me = store.get("rm-name", ""); S.code = store.get("rm-code", ""); S.pin = store.get("rm-pin", ""); S.admin = store.get("rm-admin", "");
  S.big = store.get("rm-big", false); applyBig();
  setHide(store.get("wip-hide", {}));
  S.sheet = store.get("wip-sheet", "wip"); S.tab = store.get("wip-tab", "input");
  S.loc = store.get("wip-loc-" + S.sheet, SHEETS.find(s => s.key === S.sheet).locs[0]);
  const now = new Date(), end = addMonth(ym(now), 1), opts = [];
  for (let m = FIRST_MONTH; m <= end; m = addMonth(m, 1)) opts.unshift(m);
  $("monthSel").innerHTML = opts.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  const guess = now.getDate() >= 20 ? ym(now) : addMonth(ym(now), -1), saved = store.get("rm-month", null);
  S.month = opts.includes(saved) ? saved : opts.includes(guess) ? guess : opts[opts.length - 1];
  $("monthSel").value = S.month;
  try { await loadItems() } catch { toast("품목 목록을 불러오지 못했습니다.") }
  setMonth(S.month);
  flush();
  // 지난달 비규격 현장 이름 (입력할 때 고르기용)
  if (API && S.code) apiGet({ action: "list", month: addMonth(S.month, -1), form: "wip" }).then(j => { if (j.entries) store.set("wip-cache-" + addMonth(S.month, -1), j.entries) }).catch(() => {});
  setInterval(() => { if (!document.hidden && !sheet && !dlg) refresh() }, 60000);
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); refresh() } });
})();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  const hadOld = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadOld && !reloaded && !sheet && !dlg) { reloaded = true; location.reload() } });
}
